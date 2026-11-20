/* Essential chat feature layer. Loaded after script.js; extends the current app
   without changing its established message/content types or storage buckets. */
(() => {
  "use strict";

  const GIPHY_API_KEY = "nhxmno6ShEtecJvi24KzySkZSlqWPk9b"; // Replace here if this key is rotated.
  const GIPHY_LIMIT = 20;
  const GIPHY_TRENDING_TTL = 8 * 60 * 1000;
  const DRAFT_DEBOUNCE_MS = 420;
  const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
  const $ = (id) => document.getElementById(id);

  CONFIG.APP_NAME = "Essential";
  STATE.selectedMessageKind = "normal";
  STATE.pendingUploadKind = "normal";
  STATE.pollData = new Map();
  STATE.noticeDismissals = new Set();
  STATE.noticeQueue = [];
  STATE.activeNoticeKey = null;
  STATE.featureChannel = null;
  STATE.featureIntervalId = null;
  STATE.timerIntervalId = null;
  STATE.draftTimeoutId = null;
  STATE.draftSaving = false;
  STATE.draftWriteQueue = Promise.resolve();
  STATE.draftCacheKey = null;
  STATE.giphyTrendingCache = { data: [], expires: 0 };
  STATE.giphySearchCache = new Map();
  STATE.giphySearchTimer = null;
  STATE.giphySearchController = null;
  STATE.giphySelected = new Map();
  STATE.giphyItems = [];
  STATE.scheduledEditId = null;
  STATE.pendingPreviewFiles = [];
  STATE.noticeLoading = false;
  STATE.noticeMessageIds = new Set();
  STATE.urgentMessageIds = new Set();
  STATE.timerMessageIds = new Set();
  STATE.pollLoadTimers = new Map();
  STATE.giphyTrendingPromise = null;
  STATE.floatingControlObserver = null;

  const base = {
    setupEventListeners,
    loadMessages,
    renderMessagesList,
    createMessageBubbleElement,
    renderSingleMessage,
    handleRealtimeMessageChange,
    subscribeRealtime,
    insertChatMessage,
    handleSendMessage,
    stopAndSendRecording,
    prepareMediaFiles,
    cancelMediaPreview,
    prepareArtForSending,
    openMediaGallery,
    openMessageInfoModal,
    onComposerInput,
    handleChatScroll,
    updateJumpToLatestButton,
    scrollToBottom,
    handleFileSelected,
    handleDocumentFileSelected,
    handleGifFileSelected,
    openDevicePicker,
    createInlineVoicePlayer
  };

  function localDateTimeValue(date) {
    const d = new Date(date);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fromLocalDateTime(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  function activeComposerMetadata() {
    const scheduleEnabled = !!$("scheduleToggle")?.checked;
    let scheduledFor = null;
    if (scheduleEnabled) {
      scheduledFor = fromLocalDateTime($("scheduledForInput")?.value);
      if (!scheduledFor || new Date(scheduledFor).getTime() <= Date.now()) {
        throw new Error("Choose a future date and time for scheduled delivery.");
      }
    }
    return {
      is_urgent: !!$("urgentToggle")?.checked,
      is_surprise: !!$("surpriseToggle")?.checked,
      scheduled_for: scheduledFor
    };
  }

  function resetComposerFeatureSettings() {
    STATE.selectedMessageKind = "normal";
    if ($("urgentToggle")) $("urgentToggle").checked = false;
    if ($("surpriseToggle")) $("surpriseToggle").checked = false;
    if ($("scheduleToggle")) $("scheduleToggle").checked = false;
    if ($("scheduledForInput")) $("scheduledForInput").value = "";
    if ($("pollAllowMultiple")) $("pollAllowMultiple").checked = false;
    if ($("countdownInfinite")) $("countdownInfinite").checked = false;
    if ($("countdownTarget")) $("countdownTarget").value = "";
    if ($("countdownMode")) $("countdownMode").value = "countdown";
    document.querySelectorAll(".poll-option-input").forEach((input, i) => {
      input.value = "";
      input.placeholder = `Option ${i + 1}`;
    });
    updateMessageTypeUI();
  }

  function updateMessageTypeUI() {
    const panel = $("messageTypePanel");
    const button = $("btnMessageType");
    const kind = STATE.selectedMessageKind || "normal";
    const label = kind === "poll" ? "Poll" : kind === "countdown" ? "Countdown / Count-up" : "Normal";
    const compactMark = kind === "poll" ? "P" : kind === "countdown" ? "C" : "N";
    if (button) {
      button.innerHTML = `<span class="composer-type-mark" aria-hidden="true">${compactMark}</span><span class="composer-type-label">${label}</span><span class="composer-type-chevron" aria-hidden="true">⌄</span>`;
      button.title = "Message Type";
      button.setAttribute("aria-label", `Message Type: ${label}`);
    }
    document.querySelectorAll(".message-type-choice").forEach((choice) => {
      choice.classList.toggle("active", choice.dataset.messageKind === kind);
    });
    $("pollComposerFields")?.classList.toggle("hidden", kind !== "poll");
    $("countdownComposerFields")?.classList.toggle("hidden", kind !== "countdown");
    $("scheduleComposerFields")?.classList.toggle("hidden", !$("scheduleToggle")?.checked);
    const countdownMode = $("countdownMode")?.value || "countdown";
    const infiniteCountup = countdownMode === "countup" && !!$("countdownInfinite")?.checked;
    $("countdownDurationRow")?.classList.toggle("hidden", kind !== "countdown" || countdownMode !== "countdown" || !!$("countdownTarget")?.value);
    if ($("countdownTarget")) $("countdownTarget").disabled = kind !== "countdown" || infiniteCountup;
    if ($("countdownTarget")) $("countdownTarget").classList.toggle("is-disabled", infiniteCountup);
    const ta = $("messageTextArea");
    if (ta && !STATE.editingMessageId) {
      ta.placeholder = kind === "poll" ? "Write your poll question…" : kind === "countdown" ? "Name this timer…" : "Write a message…";
    }
    if (panel) panel.setAttribute("aria-hidden", panel.classList.contains("hidden") ? "true" : "false");
  }

  function setSelectedMessageKind(kind) {
    STATE.selectedMessageKind = ["normal", "poll", "countdown"].includes(kind) ? kind : "normal";
    updateMessageTypeUI();
  }

  function setupFloatingControls() {
    const screen = $("chatScreen");
    const footer = document.querySelector(".chat-footer");
    const header = document.querySelector(".chat-header");
    if (!screen || !footer) return;
    // Measure the actual safe-area inset instead of blindly adding the full
    // Android system-navigation area to the composer. Three-button navigation
    // reports a larger inset on Android than gesture navigation; using that
    // full value as footer padding creates the visible gap reported on phones.
    const root = document.documentElement;
    const isAndroid = /Android/i.test(navigator.userAgent || "");
    const safeAreaProbe = document.createElement("div");
    safeAreaProbe.setAttribute("aria-hidden", "true");
    safeAreaProbe.style.cssText = "position:fixed;left:-10000px;bottom:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-bottom:env(safe-area-inset-bottom,0px);";
    document.body.appendChild(safeAreaProbe);

    const measure = () => {
      const footerHeight = Math.ceil(footer.getBoundingClientRect().height || 0);
      const headerHeight = Math.ceil(header?.getBoundingClientRect().height || 70);
      screen.style.setProperty("--chat-footer-height", `${footerHeight}px`);
      screen.style.setProperty("--chat-header-height", `${headerHeight}px`);

      const viewport = window.visualViewport;
      const viewportHeight = viewport?.height || window.innerHeight;
      const keyboardOpen = !!viewport && (window.innerHeight - viewport.height > 120);
      const safeAreaBottom = Math.max(0, parseFloat(getComputedStyle(safeAreaProbe).paddingBottom) || 0);

      // Preserve the existing safe-area spacing in gesture mode and on iOS.
      // Android's larger three-button navigation inset is already outside the
      // usable content area on these devices, so applying it again lifts the
      // composer and leaves an empty strip above the system navigation buttons.
      const isAndroidThreeButtonInset = isAndroid && safeAreaBottom >= 20;
      const composerBottomInset = keyboardOpen || isAndroidThreeButtonInset ? 0 : safeAreaBottom;
      root.style.setProperty("--essential-chat-bottom-inset", `${composerBottomInset}px`);
      root.classList.toggle("essential-keyboard-visible", keyboardOpen);

      // visualViewport shrinks when the on-screen keyboard opens, keeping the
      // complete chat (including its footer) docked directly above the keyboard.
      if (viewportHeight && viewportHeight > 0) {
        root.style.setProperty("--essential-viewport-height", `${Math.round(viewportHeight)}px`);
      }
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      STATE.floatingControlObserver?.disconnect();
      STATE.floatingControlObserver = new ResizeObserver(measure);
      STATE.floatingControlObserver.observe(footer);
      if (header) STATE.floatingControlObserver.observe(header);
    }
    window.addEventListener("resize", measure, { passive: true });
    window.addEventListener("orientationchange", measure, { passive: true });
    window.visualViewport?.addEventListener("resize", measure, { passive: true });
    window.visualViewport?.addEventListener("scroll", measure, { passive: true });
  }

  function setupAdvancedEventListeners() {
    $("btnMessageType").onclick = () => {
      const panel = $("messageTypePanel");
      const hidden = panel.classList.toggle("hidden");
      $("btnMessageType").setAttribute("aria-expanded", String(!hidden));
      updateMessageTypeUI();
    };
    document.querySelectorAll(".message-type-choice").forEach((choice) => {
      choice.onclick = () => setSelectedMessageKind(choice.dataset.messageKind);
    });
    ["urgentToggle", "surpriseToggle", "scheduleToggle"].forEach((id) => {
      $(id).addEventListener("change", updateMessageTypeUI);
    });
    $("btnAddPollOption").onclick = () => {
      const list = $("pollOptionsInputList");
      const count = list.querySelectorAll(".poll-option-input").length;
      if (count >= 10) return showToast("A poll can have up to 10 options.");
      const input = document.createElement("input");
      input.className = "poll-option-input";
      input.maxLength = 100;
      input.placeholder = `Option ${count + 1}`;
      list.appendChild(input);
      input.focus();
    };
    $("btnNewMessageNotice").onclick = () => scrollToBottom(false);
    $("btnJumpToLatest").onclick = () => scrollToBottom(false);
    $("btnOpenArtGallery").onclick = () => { closeMenus(); openArtGallery(); };
    $("btnOpenScheduledGallery").onclick = () => { closeMenus(); openScheduledGallery(); };
    $("btnCloseArtGallery").onclick = () => closeModal("artGalleryOverlay");
    $("btnCloseScheduledGallery").onclick = () => closeModal("scheduledGalleryOverlay");
    $("btnCloseScheduledEdit").onclick = () => closeModal("scheduledEditOverlay");
    $("btnSaveScheduledEdit").onclick = saveScheduledEdit;
    $("btnCloseGifPicker").onclick = () => closeModal("gifPickerOverlay");
    $("btnUploadGifFiles").onclick = () => {
      STATE.pendingUploadKind = "gif";
      closeModal("gifPickerOverlay");
      const input = $("gifFileInput");
      input.value = "";
      input.click();
    };
    $("btnSendSelectedGifs").onclick = sendSelectedGifs;
    $("gifSearchInput").addEventListener("input", onGiphySearchInput);
    $("btnAddMorePreview").onclick = () => {
      const input = $("mediaFileInput");
      input.value = "";
      input.click();
    };
    $("btnCopyMessageInfo").onclick = copyMessageInfo;
    $("btnChooseGif").onclick = () => openGifPicker();
    $("countdownMode").addEventListener("change", updateMessageTypeUI);
    $("countdownInfinite").addEventListener("change", updateMessageTypeUI);
    $("countdownTarget").addEventListener("change", updateMessageTypeUI);
    setupFloatingControls();
    $("mediaFileInput").onchange = handleFileSelected;
    $("documentFileInput").onchange = handleDocumentFileSelected;
    $("gifFileInput").onchange = handleGifFileSelected;
    updateMessageTypeUI();
  }

  setupEventListeners = function () {
    base.setupEventListeners();
    setupAdvancedEventListeners();
  };

  function cacheDraftKey() {
    return `essential-draft:${STATE.currentUser?.key || "unknown"}`;
  }

  function scheduleDraftSave() {
    if (!STATE.currentUser || !STATE.roomId || STATE.editingMessageId) return;
    const content = $("messageTextArea")?.value ?? "";
    STATE.draftCacheKey = cacheDraftKey();
    try {
      if (content) localStorage.setItem(STATE.draftCacheKey, JSON.stringify({ content, savedAt: Date.now() }));
      else localStorage.removeItem(STATE.draftCacheKey);
    } catch { /* local fallback is optional; Supabase remains the source of truth */ }
    clearTimeout(STATE.draftTimeoutId);
    STATE.draftTimeoutId = setTimeout(() => persistDraftToSupabase(content), DRAFT_DEBOUNCE_MS);
  }

  function persistDraftToSupabase(content = $("messageTextArea")?.value ?? "") {
    if (!STATE.currentUser || !STATE.roomId || STATE.editingMessageId) return Promise.resolve();
    const value = String(content).slice(0, 4000);
    const roomId = STATE.roomId;
    const identityKey = STATE.currentUser.key;
    const supabase = STATE.supabase;
    // Serialize writes so a fast send/clear cannot be overtaken by an older
    // debounced upsert that was already in flight or cross identity changes.
    const write = async () => {
      try {
        if (!value.trim()) {
          const { error } = await supabase.from("chat_message_drafts")
            .delete().eq("room_id", roomId).eq("identity_key", identityKey);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("chat_message_drafts").upsert({
            room_id: roomId,
            identity_key: identityKey,
            content: value,
            updated_at: new Date().toISOString()
          }, { onConflict: "room_id,identity_key" });
          if (error) throw error;
        }
      } catch (error) {
        console.warn("Draft sync unavailable", error);
      }
    };
    STATE.draftWriteQueue = (STATE.draftWriteQueue || Promise.resolve()).catch(() => {}).then(write);
    return STATE.draftWriteQueue;
  }

  async function loadDraftFromSupabase() {
    if (!STATE.currentUser || !STATE.roomId) return;
    const key = cacheDraftKey();
    let localDraft = "";
    let localSavedAt = 0;
    try {
      const cached = JSON.parse(localStorage.getItem(key) || "null");
      localDraft = cached?.content || "";
      localSavedAt = Number(cached?.savedAt) || 0;
    } catch { /* ignore */ }
    try {
      const { data, error } = await STATE.supabase.from("chat_message_drafts")
        .select("content,updated_at").eq("room_id", STATE.roomId)
        .eq("identity_key", STATE.currentUser.key).maybeSingle();
      if (error) throw error;
      const remote = data?.content || "";
      const remoteSavedAt = data?.updated_at ? new Date(data.updated_at).getTime() : 0;
      const text = remoteSavedAt >= localSavedAt ? remote : localDraft;
      if (text && !$("messageTextArea").value.trim()) {
        $("messageTextArea").value = text;
        base.onComposerInput();
      }
      if (text) {
        try { localStorage.setItem(key, JSON.stringify({ content: text, savedAt: Math.max(Date.now(), remoteSavedAt || 0) })); } catch { /* ignore */ }
      }
    } catch (error) {
      console.warn("Could not restore Supabase draft; using local recovery copy", error);
      if (localDraft && !$("messageTextArea").value.trim()) {
        $("messageTextArea").value = localDraft;
        base.onComposerInput();
      }
    }
  }

  async function clearDraftEverywhere() {
    if (!STATE.currentUser || !STATE.roomId) return;
    clearTimeout(STATE.draftTimeoutId);
    try { localStorage.removeItem(cacheDraftKey()); } catch { /* ignore */ }
    await persistDraftToSupabase("");
  }

  onComposerInput = function () {
    base.onComposerInput();
    if (!STATE.editingMessageId) scheduleDraftSave();
  };

  function appendMessageToStateAndDom(message, scroll = false) {
    if (!message?.id || STATE.messageById.has(message.id)) return;
    const item = { ...message, message_reactions: message.message_reactions || [], message_visibility: message.message_visibility || [] };
    STATE.messages.push(item);
    STATE.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    STATE.messageById.set(item.id, item);
    const list = $("messagesList");
    $("emptyChatState")?.classList.add("hidden");
    const row = createMessageBubbleElement(item);
    const rows = list.querySelectorAll(".message-row");
    const lastRow = rows.length ? rows[rows.length - 1] : null;
    const dateLabel = new Date(item.created_at).toDateString();
    const lastDate = lastRow?.dataset.createdDate || "";
    if (lastDate !== dateLabel) {
      const separator = document.createElement("div");
      separator.className = "date-separator";
      separator.textContent = formatDateGroup(new Date(item.created_at));
      list.appendChild(separator);
    }
    row.dataset.createdDate = dateLabel;
    list.appendChild(row);
    STATE.noticeMessageIds.add(item.id);
    if (item.is_urgent && item.sender_key !== STATE.currentUser?.key) STATE.urgentMessageIds.add(item.id);
    if (item.message_kind === "countdown") STATE.timerMessageIds.add(item.id);
    if (scroll) scrollToBottom(false);
    if (row.classList.contains("counterpart")) STATE.seenObserver?.observe(row);
    if (item.message_kind === "poll") loadPollData(item.id);
    refreshMessageNotices();
  }

  insertChatMessage = async function (fields, replyToId = STATE.replyTargetMessage?.id || null) {
    if (!STATE.supabase || !STATE.currentUser || !STATE.roomId) throw new Error("Your chat session is not ready. Sign in again.");
    const featureMeta = activeComposerMetadata();
    const row = {
      ...fields,
      message_kind: fields.message_kind || (STATE.pendingUploadKind !== "normal" ? STATE.pendingUploadKind : "normal"),
      is_urgent: fields.is_urgent ?? featureMeta.is_urgent,
      is_surprise: fields.is_surprise ?? featureMeta.is_surprise,
      scheduled_for: fields.scheduled_for ?? featureMeta.scheduled_for,
      feature_data: fields.feature_data || {},
      room_id: STATE.roomId,
      sender_key: STATE.currentUser.key,
      reply_to_id: replyToId || null
    };
    const { data, error } = await STATE.supabase.from("messages").insert(row).select("*").single();
    if (error) throw error;
    appendMessageToStateAndDom(data, true);
    return data;
  };

  async function appendLoadedPollUpdates() {
    const ids = STATE.messages.filter((msg) => msg.message_kind === "poll").map((msg) => msg.id);
    if (!ids.length) return;
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100);
      try {
        const [optionResult, voteResult] = await Promise.all([
          STATE.supabase.from("message_poll_options").select("id,message_id,option_text,position")
            .in("message_id", batch).order("position", { ascending: true }),
          STATE.supabase.from("message_poll_votes").select("id,message_id,option_id,identity_key,created_at")
            .in("message_id", batch)
        ]);
        if (optionResult.error) throw optionResult.error;
        if (voteResult.error) throw voteResult.error;
        const byId = new Map(batch.map((id) => [id, { options: [], votes: [] }]));
        (optionResult.data || []).forEach((row) => byId.get(row.message_id)?.options.push(row));
        (voteResult.data || []).forEach((row) => byId.get(row.message_id)?.votes.push(row));
        byId.forEach((value, id) => {
          STATE.pollData.set(id, value);
          if (STATE.messageById.has(id)) renderSingleMessage(id);
        });
      } catch (error) {
        console.warn("Poll details are not available", error);
      }
    }
  }

  loadMessages = async function () {
    await base.loadMessages();
    if (!STATE.currentUser || !STATE.roomId) return;
    STATE.noticeMessageIds = new Set(STATE.messages.map((message) => message.id));
    STATE.urgentMessageIds = new Set(STATE.messages.filter((message) => message.is_urgent && message.sender_key !== STATE.currentUser.key).map((message) => message.id));
    STATE.timerMessageIds = new Set(STATE.messages.filter((message) => message.message_kind === "countdown").map((message) => message.id));
    await Promise.all([loadDraftFromSupabase(), loadNoticeDismissals(), appendLoadedPollUpdates()]);
    refreshMessageNotices();
    startFeatureWorkers();
  };

  function pollVoteRowsFor(messageId) {
    return STATE.pollData.get(messageId) || { options: [], votes: [] };
  }

  async function loadPollData(messageId) {
    if (!messageId || !STATE.supabase) return;
    try {
      const [optionResult, voteResult] = await Promise.all([
        STATE.supabase.from("message_poll_options").select("id,message_id,option_text,position")
          .eq("message_id", messageId).order("position", { ascending: true }),
        STATE.supabase.from("message_poll_votes").select("id,message_id,option_id,identity_key,created_at")
          .eq("message_id", messageId)
      ]);
      if (optionResult.error) throw optionResult.error;
      if (voteResult.error) throw voteResult.error;
      STATE.pollData.set(messageId, { options: optionResult.data || [], votes: voteResult.data || [] });
      if (STATE.messageById.has(messageId)) renderSingleMessage(messageId);
    } catch (error) {
      console.warn("Poll details are not available", error);
    }
  }

  function schedulePollRefresh(messageId) {
    clearTimeout(STATE.pollLoadTimers.get(messageId));
    STATE.pollLoadTimers.set(messageId, setTimeout(() => {
      STATE.pollLoadTimers.delete(messageId);
      loadPollData(messageId);
    }, 90));
  }

  async function submitPollVote(messageId, optionIds) {
    const { error } = await STATE.supabase.rpc("vote_chat_poll", {
      p_message_id: messageId,
      p_option_ids: optionIds
    });
    if (error) return showToast(error.message || "Your vote could not be saved.");
    await loadPollData(messageId);
  }

  function renderPollBlock(msg) {
    const data = pollVoteRowsFor(msg.id);
    const allowMultiple = !!msg.feature_data?.allow_multiple;
    const selected = data.votes.filter((vote) => vote.identity_key === STATE.currentUser?.key).map((vote) => vote.option_id);
    const wrap = document.createElement("section");
    wrap.className = "poll-message-block";
    if (!data.options.length) {
      const pending = document.createElement("div");
      pending.className = "poll-loading";
      pending.textContent = "Loading poll…";
      wrap.appendChild(pending);
      return wrap;
    }
    data.options.forEach((option) => {
      const voters = data.votes.filter((vote) => vote.option_id === option.id);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `poll-option-button${selected.includes(option.id) ? " is-selected" : ""}`;
      const title = document.createElement("span");
      title.className = "poll-option-title";
      title.textContent = option.option_text;
      const count = document.createElement("span");
      count.className = "poll-option-count";
      count.textContent = String(voters.length);
      const bar = document.createElement("span");
      bar.className = "poll-option-bar";
      const fill = document.createElement("i");
      const totalVotes = data.votes.length || 0;
      fill.style.width = `${totalVotes ? (voters.length / totalVotes) * 100 : 0}%`;
      bar.appendChild(fill);
      const names = document.createElement("small");
      names.className = "poll-option-voters";
      names.textContent = voters.length ? voters.map((v) => v.identity_key === STATE.currentUser.key ? STATE.currentUser.name : STATE.counterpartUser.name).join(", ") : "No votes yet";
      button.append(title, count, bar, names);
      button.onclick = (event) => {
        event.stopPropagation();
        let next = [option.id];
        if (allowMultiple) {
          next = selected.includes(option.id) ? selected.filter((id) => id !== option.id) : [...selected, option.id];
        }
        if (allowMultiple && next.length === 0) return showToast("Choose at least one option.");
        submitPollVote(msg.id, next);
      };
      wrap.appendChild(button);
    });
    const footer = document.createElement("div");
    footer.className = "poll-footer-note";
    footer.textContent = `${data.votes.length} vote${data.votes.length === 1 ? "" : "s"} · ${allowMultiple ? "Multiple choices allowed" : "Choose one"}`;
    wrap.appendChild(footer);
    return wrap;
  }

  function timerText(msg, now = Date.now()) {
    const data = msg.feature_data || {};
    const mode = data.mode || "countdown";
    const scheduledStart = msg.scheduled_for ? new Date(msg.scheduled_for).getTime() : null;
    if (scheduledStart && !msg.delivered_at && now < scheduledStart) {
      return `Starts ${new Date(scheduledStart).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`;
    }
    const stoppedAt = msg.timer_stopped_at ? new Date(msg.timer_stopped_at).getTime() : null;
    const target = data.target_at ? new Date(data.target_at).getTime() : null;
    if (stoppedAt) {
      const elapsed = Math.max(0, Math.floor((stoppedAt - new Date(data.started_at || msg.created_at).getTime()) / 1000));
      return `Stopped · ${formatDuration(elapsed)}`;
    }
    if (mode === "countdown") {
      const left = Math.max(0, Math.ceil(((target || now) - now) / 1000));
      if (left <= 0) return "Time reached";
      const days = Math.floor(left / 86400);
      const hours = Math.floor((left % 86400) / 3600);
      const mins = Math.floor((left % 3600) / 60);
      const secs = left % 60;
      return `${days ? `${days}d ` : ""}${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    const start = new Date(data.started_at || msg.created_at).getTime();
    const finish = target ? Math.min(now, target) : now;
    const elapsed = Math.max(0, Math.floor((finish - start) / 1000));
    const label = formatDuration(elapsed);
    return target && now >= target ? `Target reached · ${label}` : label;
  }

  function renderTimerBlock(msg) {
    const data = msg.feature_data || {};
    const wrap = document.createElement("section");
    wrap.className = "countdown-message-block";
    const label = document.createElement("div");
    label.className = "countdown-label";
    label.textContent = data.name || msg.content || "Timer";
    const value = document.createElement("div");
    value.className = "live-timer-display";
    value.dataset.messageId = msg.id;
    value.textContent = timerText(msg);
    const caption = document.createElement("small");
    caption.textContent = data.mode === "countup" ? (data.infinite ? "Count-up · Infinity" : "Count-up") : "Countdown";
    wrap.append(label, value, caption);
    if (data.mode === "countup" && data.infinite && !msg.timer_stopped_at) {
      const stop = document.createElement("button");
      stop.type = "button";
      stop.className = "timer-stop-button";
      stop.textContent = "Stop timer";
      stop.onclick = async (event) => {
        event.stopPropagation();
        stop.disabled = true;
        const { error } = await STATE.supabase.rpc("stop_chat_countup", { p_message_id: msg.id });
        if (error) {
          stop.disabled = false;
          showToast(error.message || "Unable to stop this timer.");
        } else {
          const { data: refreshed } = await STATE.supabase.from("messages").select("*").eq("id", msg.id).maybeSingle();
          if (refreshed) Object.assign(msg, refreshed);
          renderSingleMessage(msg.id);
          refreshMessageNotices();
        }
      };
      wrap.appendChild(stop);
    }
    return wrap;
  }

  createMessageBubbleElement = function (msg) {
    const row = base.createMessageBubbleElement(msg);
    const bubble = row.querySelector(".message-bubble");
    if (!bubble) return row;
    if (msg.is_urgent) bubble.classList.add("urgent-message-bubble");
    if (msg.scheduled_for && !msg.delivered_at) {
      const tag = document.createElement("div");
      tag.className = "scheduled-message-tag";
      tag.textContent = `Scheduled · ${new Date(msg.scheduled_for).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`;
      bubble.appendChild(tag);
    }
    const primaryText = [...bubble.querySelectorAll(":scope > p")].find((p) => !p.classList.contains("deleted-message"));
    if ((msg.message_type === "text" || msg.message_type === "link") && primaryText && msg.content && msg.content.length > 500) {
      let expanded = false;
      const render = () => {
        primaryText.innerHTML = "";
        const copy = document.createElement("span");
        copy.className = "message-text-content";
        appendLinkifiedText(copy, expanded ? msg.content : `${msg.content.slice(0, 500).trimEnd()}…`);
        primaryText.appendChild(copy);
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "message-expand-btn";
        toggle.textContent = expanded ? "Show less" : "Show more";
        toggle.onclick = (event) => { event.stopPropagation(); expanded = !expanded; render(); };
        primaryText.appendChild(toggle);
      };
      render();
    }
    if (msg.message_kind === "poll" && !msg.is_deleted_everyone) {
      if (primaryText) primaryText.classList.add("poll-question");
      const poll = renderPollBlock(msg);
      if (primaryText) primaryText.after(poll); else bubble.appendChild(poll);
    }
    if (msg.message_kind === "countdown" && !msg.is_deleted_everyone) {
      if (primaryText) primaryText.classList.add("timer-message-title");
      const timer = renderTimerBlock(msg);
      if (primaryText) primaryText.after(timer); else bubble.appendChild(timer);
    }
    if (msg.message_kind === "art" || msg.message_kind === "gif") {
      const kindTag = document.createElement("span");
      kindTag.className = "message-kind-tag";
      kindTag.textContent = msg.message_kind === "art" ? "ART" : "GIF";
      bubble.insertBefore(kindTag, bubble.firstChild);
    }
    if (msg.is_surprise && !msg.is_deleted_everyone) {
      let revealed = false;
      try { revealed = localStorage.getItem(`essential-surprise:${STATE.currentUser?.key}:${msg.id}`) === "1"; } catch { /* ignore */ }
      if (!revealed) {
        bubble.classList.add("surprise-covered");
        const cover = document.createElement("button");
        cover.type = "button";
        cover.className = "surprise-cover-button";
        cover.textContent = "Tap to reveal";
        cover.onclick = (event) => {
          event.stopPropagation();
          try { localStorage.setItem(`essential-surprise:${STATE.currentUser?.key}:${msg.id}`, "1"); } catch { /* ignore */ }
          bubble.classList.remove("surprise-covered");
          cover.remove();
        };
        bubble.appendChild(cover);
      }
    }
    if (msg.is_pinned) {
      const pin = bubble.querySelector(".message-pinned-indicator");
      if (pin && !pin.querySelector(".pin-symbol")) {
        const text = pin.textContent.replace("📌", "").trim() || "Pinned";
        pin.textContent = "";
        const icon = document.createElement("span");
        icon.className = "pin-symbol";
        icon.textContent = "📌";
        const label = document.createElement("span");
        label.textContent = text;
        pin.append(icon, label);
      }
    }
    return row;
  };

  renderSingleMessage = function (id) {
    const old = document.querySelector(`.message-row[data-id="${CSS.escape(String(id))}"]`);
    const message = STATE.messageById.get(id);
    if (!old || !message) return;
    const fresh = createMessageBubbleElement(message);
    old.replaceWith(fresh);
    if (fresh.classList.contains("counterpart")) STATE.seenObserver?.observe(fresh);
  };

  renderMessagesList = function (forceBottom = false) {
    base.renderMessagesList(forceBottom);
    requestAnimationFrame(() => {
      document.querySelectorAll("#messagesList .message-row").forEach((row) => {
        const message = STATE.messageById.get(row.dataset.id);
        if (message) row.dataset.createdDate = new Date(message.created_at).toDateString();
      });
    });
  };

  handleRealtimeMessageChange = function (payload) {
    if (!payload?.eventType || !STATE.roomId) return;
    if (payload.eventType === "INSERT") {
      const incoming = payload.new;
      if (!incoming || incoming.room_id !== STATE.roomId || STATE.messageById.has(incoming.id)) return;
      const stick = isNearBottom();
      appendMessageToStateAndDom(incoming, stick);
      if (!stick && incoming.sender_key !== STATE.currentUser?.key) {
        STATE.pendingNewMessagesBelow = (STATE.pendingNewMessagesBelow || 0) + 1;
        updateJumpToLatestButton();
      }
      updateJumpToLatestButton();
      return;
    }
    if (payload.eventType === "UPDATE") {
      const updated = payload.new;
      if (!updated?.id) return;
      const current = STATE.messageById.get(updated.id);
      if (!current) {
        loadMessages();
        return;
      }
      Object.assign(current, updated);
      if (current.is_urgent && current.sender_key !== STATE.currentUser?.key) STATE.urgentMessageIds.add(updated.id);
      else STATE.urgentMessageIds.delete(updated.id);
      if (current.message_kind === "countdown") STATE.timerMessageIds.add(updated.id);
      else STATE.timerMessageIds.delete(updated.id);
      renderSingleMessage(updated.id);
      refreshMessageNotices();
      return;
    }
    if (payload.eventType === "DELETE") {
      const id = payload.old?.id;
      if (!id) return;
      STATE.messages = STATE.messages.filter((message) => message.id !== id);
      STATE.messageById.delete(id);
      STATE.pollData.delete(id);
      STATE.noticeMessageIds.delete(id);
      STATE.urgentMessageIds.delete(id);
      STATE.timerMessageIds.delete(id);
      renderMessagesList(false);
    }
  };

  subscribeRealtime = function () {
    base.subscribeRealtime();
    if (STATE.featureChannel) STATE.supabase.removeChannel(STATE.featureChannel);
    STATE.featureChannel = STATE.supabase.channel(`essential_features_${STATE.roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "message_poll_options" }, (payload) => {
        const id = payload.new?.message_id || payload.old?.message_id;
        if (id) schedulePollRefresh(id);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "message_poll_votes" }, (payload) => {
        const id = payload.new?.message_id || payload.old?.message_id;
        if (id) schedulePollRefresh(id);
      })
      .subscribe();
  };

  function updateNoticeDismissalsSet(rows) {
    STATE.noticeDismissals = new Set((rows || []).map((row) => `${row.message_id}|${row.notice_type}`));
  }

  async function loadNoticeDismissals() {
    if (!STATE.currentUser) return;
    try {
      const { data, error } = await STATE.supabase.from("message_notice_dismissals")
        .select("message_id,notice_type").eq("identity_key", STATE.currentUser.key);
      if (error) throw error;
      updateNoticeDismissalsSet(data);
    } catch (error) {
      console.warn("Notification dismissal state is not available", error);
    }
  }

  function refreshMessageNotices() {
    if (!STATE.currentUser) return;
    const queue = [];
    const now = Date.now();
    for (const id of STATE.urgentMessageIds) {
      const message = STATE.messageById.get(id);
      if (!message || message.is_deleted_everyone || (message.scheduled_for && !message.delivered_at)) continue;
      const key = `${message.id}|urgent`;
      if (!STATE.noticeDismissals.has(key)) queue.push({ key, message, type: "urgent", at: new Date(message.created_at).getTime() });
    }
    for (const id of STATE.timerMessageIds) {
      const message = STATE.messageById.get(id);
      if (!message || message.is_deleted_everyone || (message.scheduled_for && !message.delivered_at)) continue;
      const data = message.feature_data || {};
      const targetAt = data.target_at ? new Date(data.target_at).getTime() : null;
      const stoppedAt = message.timer_stopped_at ? new Date(message.timer_stopped_at).getTime() : null;
      const completed = (targetAt && now >= targetAt) || (stoppedAt && data.mode === "countup" && data.infinite);
      const key = `${message.id}|timer`;
      if (completed && !STATE.noticeDismissals.has(key)) queue.push({ key, message, type: "timer", at: targetAt || stoppedAt || now });
    }
    queue.sort((a, b) => a.at - b.at || (a.type === "urgent" ? -1 : 1));
    STATE.noticeQueue = queue;
    renderCurrentNotice();
  }

  function renderCurrentNotice() {
    const host = $("messageNoticeHost");
    if (!host) return;
    const current = STATE.noticeQueue[0];
    if (!current) {
      host.innerHTML = "";
      STATE.activeNoticeKey = null;
      return;
    }
    if (STATE.activeNoticeKey === current.key && host.firstElementChild) return;
    STATE.activeNoticeKey = current.key;
    host.innerHTML = "";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `message-notice-button ${current.type === "urgent" ? "is-urgent" : "is-timer"}`;
    button.textContent = current.type === "urgent"
      ? "There is an urgent message"
      : `Timer finished · ${current.message.feature_data?.name || current.message.content || "Countdown"}`;
    button.onclick = () => dismissCurrentNotice(current);
    host.appendChild(button);
  }

  async function dismissCurrentNotice(notice) {
    if (!notice) return;
    const { error } = await STATE.supabase.rpc("dismiss_message_notice", {
      p_message_id: notice.message.id,
      p_notice_type: notice.type
    });
    if (error) console.warn("Could not persist notice dismissal", error);
    STATE.noticeDismissals.add(notice.key);
    jumpToOriginalMessage(notice.message.id);
    STATE.activeNoticeKey = null;
    refreshMessageNotices();
  }

  function startFeatureWorkers() {
    clearInterval(STATE.featureIntervalId);
    clearInterval(STATE.timerIntervalId);
    STATE.featureIntervalId = setInterval(async () => {
      if (!STATE.currentUser || !STATE.roomId) return;
      try {
        const { data, error } = await STATE.supabase.rpc("deliver_due_scheduled_messages");
        if (!error && Number(data) > 0) await loadMessages();
      } catch (error) { console.warn("Scheduled delivery fallback", error); }
    }, 30000);
    STATE.timerIntervalId = setInterval(() => {
      document.querySelectorAll(".live-timer-display[data-message-id]").forEach((node) => {
        const msg = STATE.messageById.get(node.dataset.messageId);
        if (msg) node.textContent = timerText(msg);
      });
      refreshMessageNotices();
    }, 1000);
  }

  handleChatScroll = function () {
    if (isNearBottom()) STATE.pendingNewMessagesBelow = 0;
    updateJumpToLatestButton();
  };

  updateJumpToLatestButton = function () {
    const button = $("btnJumpToLatest");
    const newButton = $("btnNewMessageNotice");
    const notAtBottom = !isNearBottom();
    if (button) button.classList.toggle("hidden", !notAtBottom);
    if (newButton) {
      const showNew = Number(STATE.pendingNewMessagesBelow || 0) > 0;
      newButton.classList.toggle("hidden", !showNew);
      const label = newButton.querySelector(".new-message-notice-label");
      if (label) label.textContent = `New message${STATE.pendingNewMessagesBelow > 1 ? `s · ${STATE.pendingNewMessagesBelow}` : ""}`;
    }
  };

  scrollToBottom = function () {
    const scroller = $("chatMessages");
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: "auto" });
    STATE.pendingNewMessagesBelow = 0;
    updateJumpToLatestButton();
  };

  function optionsFromPollComposer() {
    return [...document.querySelectorAll(".poll-option-input")].map((input) => input.value.trim()).filter(Boolean);
  }

  function validateFeatureComposer() {
    try { return { ok: true, meta: activeComposerMetadata() }; }
    catch (error) { showToast(error.message); return { ok: false }; }
  }

  handleSendMessage = async function () {
    if (STATE.editingMessageId) return base.handleSendMessage();
    if (STATE.isSendingMessage) return;
    const text = $("messageTextArea").value.trim();
    if (!text) return;
    const validation = validateFeatureComposer();
    if (!validation.ok) return;
    const meta = validation.meta;
    const kind = STATE.selectedMessageKind || "normal";
    if (kind === "normal") {
      await base.handleSendMessage();
      if (!$("messageTextArea").value.trim()) {
        resetComposerFeatureSettings();
        await clearDraftEverywhere();
      }
      return;
    }
    if (!STATE.currentUser || !STATE.roomId) return showToast("Please sign in again before sending.");
    const sendButton = $("btnSendMessage");
    sendButton.disabled = true;
    try {
      if (kind === "poll") {
        const options = optionsFromPollComposer();
        if (options.length < 2 || options.length > 10) throw new Error("Add between 2 and 10 poll options.");
        const { data, error } = await STATE.supabase.rpc("create_chat_poll", {
          p_question: text,
          p_options: options,
          p_allow_multiple: !!$("pollAllowMultiple").checked,
          p_reply_to_id: STATE.replyTargetMessage?.id || null,
          p_is_urgent: meta.is_urgent,
          p_is_surprise: meta.is_surprise,
          p_scheduled_for: meta.scheduled_for
        });
        if (error) throw error;
        const created = Array.isArray(data) ? data[0] : data;
        appendMessageToStateAndDom(created, true);
        await loadPollData(created.id);
      } else {
        const mode = $("countdownMode").value;
        const infinite = mode === "countup" && $("countdownInfinite").checked;
        const startAt = meta.scheduled_for ? new Date(meta.scheduled_for) : new Date();
        let chosen = fromLocalDateTime($("countdownTarget").value);
        if (mode === "countdown" && !chosen) {
          const durationValue = Math.max(1, Math.min(525600, Number($("countdownDurationValue")?.value) || 10));
          const unit = $("countdownDurationUnit")?.value || "minutes";
          const multipliers = { seconds: 1000, minutes: 60000, hours: 3600000, days: 86400000 };
          chosen = new Date(startAt.getTime() + durationValue * (multipliers[unit] || multipliers.minutes)).toISOString();
        }
        if (mode === "countdown" && (!chosen || new Date(chosen).getTime() <= startAt.getTime())) {
          throw new Error("Choose a target date and time after the timer starts.");
        }
        if (mode === "countup" && !infinite && !chosen) {
          throw new Error("Choose a target time or enable Infinity for this count-up.");
        }
        if (mode === "countup" && chosen && new Date(chosen).getTime() <= startAt.getTime()) {
          throw new Error("The count-up target must be after the timer starts.");
        }
        const featureData = {
          name: text,
          mode,
          infinite,
          started_at: startAt.toISOString(),
          target_at: mode === "countdown" ? chosen : (infinite ? null : chosen)
        };
        const created = await insertChatMessage({
          message_type: "text",
          content: text,
          message_kind: "countdown",
          feature_data: featureData,
          is_urgent: meta.is_urgent,
          is_surprise: meta.is_surprise,
          scheduled_for: meta.scheduled_for
        }, STATE.replyTargetMessage?.id || null);
        if (STATE.replyTargetMessage) cancelReplyState();
      }
      $("messageTextArea").value = "";
      $("messageTextArea").style.height = "auto";
      base.onComposerInput();
      resetComposerFeatureSettings();
      await clearDraftEverywhere();
      showToast(meta.scheduled_for ? "Message scheduled" : `${kind === "poll" ? "Poll" : "Timer"} sent`);
    } catch (error) {
      console.error("Feature message send", error);
      showToast(error.message || "Could not send this message.");
    } finally {
      sendButton.disabled = false;
    }
  };

  stopAndSendRecording = async function () {
    if (STATE.selectedMessageKind !== "normal") {
      showToast("Voice messages use the Normal message type. Select Normal before sending.");
      return;
    }
    const validation = validateFeatureComposer();
    if (!validation.ok) return;
    await base.stopAndSendRecording();
    resetComposerFeatureSettings();
  };

  createInlineVoicePlayer = function (msg) {
    const wrap = document.createElement("div");
    wrap.className = "voice-player";
    const row = document.createElement("div");
    row.className = "voice-controls-row";
    const play = document.createElement("button");
    play.type = "button";
    play.className = "btn-voice-play";
    play.textContent = "▶";
    play.setAttribute("aria-label", "Play voice message");
    const wave = document.createElement("div");
    wave.className = "voice-waveform";
    wave.setAttribute("role", "slider");
    wave.setAttribute("aria-label", "Voice playback position");
    wave.setAttribute("aria-valuemin", "0");
    wave.setAttribute("aria-valuemax", String(Math.max(1, Number(msg.voice_duration) || 1)));
    wave.setAttribute("aria-valuenow", "0");
    wave.setAttribute("tabindex", "0");
    const values = Array.isArray(msg.voice_waveform) && msg.voice_waveform.length ? msg.voice_waveform : null;
    const count = 48, seed = hashString(msg.id);
    for (let i = 0; i < count; i++) {
      const bar = document.createElement("span");
      bar.className = "wave-bar";
      const value = values ? Number(values[Math.min(values.length - 1, Math.floor(i / count * values.length))]) : (0.18 + ((seed + i * 17) % 79) / 100);
      bar.style.height = `${Math.max(5, Math.min(30, 6 + value * 25))}px`;
      wave.appendChild(bar);
    }
    const dot = document.createElement("span");
    dot.className = "voice-seek-dot";
    dot.setAttribute("aria-hidden", "true");
    wave.appendChild(dot);
    const speed = document.createElement("button");
    speed.type = "button";
    speed.className = "voice-speed";
    speed.textContent = "1×";
    speed.setAttribute("aria-label", "Change playback speed");
    row.append(play, wave, speed);
    const meta = document.createElement("div");
    meta.className = "voice-meta-row";
    const time = document.createElement("span");
    time.className = "voice-time-label";
    time.textContent = `0:00 / ${formatDuration(msg.voice_duration || 0)}`;
    const dl = document.createElement("button");
    dl.type = "button";
    dl.className = "voice-download-btn";
    dl.textContent = "↓ MP3";
    dl.onclick = (event) => { event.stopPropagation(); downloadVoiceAsMp3(msg); };
    meta.append(time, dl);
    wrap.append(row, meta);

    let audio = null, rateIndex = 0, dragging = false, metadataPromise = null;
    const rates = [1, 1.25, 1.5, 2];
    const paint = () => {
      const duration = audio?.duration && Number.isFinite(audio.duration) ? audio.duration : Number(msg.voice_duration) || 0;
      const current = audio?.currentTime || 0;
      const ratio = duration ? Math.max(0, Math.min(1, current / duration)) : 0;
      time.textContent = `${formatDuration(current)} / ${formatDuration(duration)}`;
      dot.style.left = `${ratio * 100}%`;
      wave.setAttribute("aria-valuemax", String(Math.max(1, duration)));
      wave.setAttribute("aria-valuenow", String(Math.round(current)));
      const played = Math.floor(ratio * (wave.children.length - 1));
      for (let i = 0; i < count; i++) wave.children[i].classList.toggle("played", i < played);
      play.textContent = audio && !audio.paused ? "Ⅱ" : "▶";
      play.setAttribute("aria-label", audio && !audio.paused ? "Pause voice message" : "Play voice message");
    };
    const ensure = async () => {
      if (audio) return audio;
      const url = await loadAuthorizedMediaUrl(msg.storage_path, CONFIG.STORAGE.VOICE_BUCKET, true);
      if (!url) throw new Error("Voice unavailable");
      audio = new Audio();
      audio.preload = "metadata";
      audio.src = url;
      audio.addEventListener("loadedmetadata", paint);
      audio.addEventListener("durationchange", paint);
      audio.addEventListener("timeupdate", paint);
      audio.addEventListener("play", paint);
      audio.addEventListener("pause", paint);
      audio.addEventListener("ended", () => {
        paint();
        if (STATE.activeAudioPlayer === audio) { STATE.activeAudioPlayer = null; STATE.activeAudioUI = null; }
      });
      audio.addEventListener("error", () => { showToast("This voice message could not be decoded by this browser."); play.textContent = "▶"; });
      audio.load();
      return audio;
    };
    const waitForMetadata = (a) => {
      if (a.readyState >= 1) return Promise.resolve();
      if (!metadataPromise) {
        metadataPromise = new Promise((resolve, reject) => {
          let timeoutId;
          const cleanup = () => {
            clearTimeout(timeoutId);
            a.removeEventListener("loadedmetadata", onLoaded);
            a.removeEventListener("error", onError);
          };
          const onLoaded = () => { cleanup(); resolve(); };
          const onError = () => { cleanup(); reject(new Error("Audio metadata unavailable")); };
          a.addEventListener("loadedmetadata", onLoaded, { once: true });
          a.addEventListener("error", onError, { once: true });
          timeoutId = setTimeout(() => { cleanup(); reject(new Error("Audio metadata timed out")); }, 12000);
          if (a.readyState >= 1) onLoaded();
        }).finally(() => { metadataPromise = null; });
      }
      return metadataPromise;
    };
    const seekAtClientX = async (clientX) => {
      const rect = wave.getBoundingClientRect();
      if (!rect.width || !Number.isFinite(clientX)) return;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const a = await ensure();
      await waitForMetadata(a);
      const duration = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : Number(msg.voice_duration) || 0;
      if (duration > 0) a.currentTime = duration * ratio;
      paint();
    };
    play.onclick = async (event) => {
      event.stopPropagation();
      try {
        const a = await ensure();
        if (a.paused) {
          if (STATE.activeAudioPlayer && STATE.activeAudioPlayer !== a) {
            STATE.activeAudioPlayer.pause();
            STATE.activeAudioUI?.();
          }
          await a.play();
          STATE.activeAudioPlayer = a;
          STATE.activeAudioUI = paint;
        } else a.pause();
        paint();
      } catch (error) { console.error("voice playback", error); showToast("Unable to play voice clip. Try downloading the original audio."); }
    };
    speed.onclick = (event) => {
      event.stopPropagation();
      rateIndex = (rateIndex + 1) % rates.length;
      speed.textContent = `${rates[rateIndex]}×`;
      if (audio) audio.playbackRate = rates[rateIndex];
    };
    wave.addEventListener("pointerdown", async (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      dragging = true;
      wave.classList.add("is-seeking");
      try { wave.setPointerCapture(event.pointerId); } catch { /* capture is optional */ }
      try { await seekAtClientX(event.clientX); } catch { showToast("Voice timeline is unavailable."); }
    });
    wave.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      event.preventDefault();
      event.stopPropagation();
      seekAtClientX(event.clientX).catch(() => {});
    });
    const stopDrag = (event) => { event?.stopPropagation?.(); dragging = false; wave.classList.remove("is-seeking"); };
    wave.addEventListener("pointerup", stopDrag);
    wave.addEventListener("pointercancel", stopDrag);
    wave.addEventListener("lostpointercapture", stopDrag);
    ["touchstart", "touchmove", "touchend", "touchcancel"].forEach((name) => wave.addEventListener(name, (event) => event.stopPropagation(), { passive: true }));
    wave.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
      event.preventDefault();
      ensure().then(async (a) => {
        await waitForMetadata(a);
        const max = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : Number(msg.voice_duration) || 0;
        a.currentTime = Math.max(0, Math.min(max, a.currentTime + (event.key === "ArrowRight" ? 5 : -5)));
        paint();
      }).catch(() => {});
    });
    paint();
    return wrap;
  };

  function isAllowedUpload(file) {
    return !!file && Number(file.size) <= MAX_UPLOAD_BYTES;
  }

  function isMediaFile(file) {
    return !!file?.type && (file.type.startsWith("image/") || file.type.startsWith("video/"));
  }

  function fileKindLabel(file) {
    if (file.type.startsWith("video/")) return "VIDEO";
    if (file.type.startsWith("image/gif") || /\.gif$/i.test(file.name)) return "GIF";
    if (file.type.startsWith("image/")) return "PHOTO";
    const ext = getFileExtension(file.name);
    return (ext || "FILE").toUpperCase().slice(0, 6);
  }

  prepareMediaFiles = function (files) {
    const chosen = Array.from(files || []);
    if (!chosen.length) return;
    const isGifFile = (file) => file.type === "image/gif" || /\.gif$/i.test(file.name || "");
    if ($("mediaPreviewOverlay").classList.contains("hidden") && STATE.pendingUploadKind === "normal" && chosen.every(isGifFile)) STATE.pendingUploadKind = "gif";
    const invalid = chosen.find((file) => !isAllowedUpload(file));
    if (invalid) return showToast(`${invalid.name || "This file"} is larger than 80 MB.`);
    const existingCount = !$("mediaPreviewOverlay").classList.contains("hidden") ? STATE.pendingUploadFiles.length : 0;
    if (existingCount + chosen.length > 50) return showToast("You can send up to 50 attachments in one batch.");
    if (STATE.selectedMessageKind !== "normal") {
      showToast("Attachments use the Normal message type; Urgent, Surprise and Schedule settings are preserved.");
      setSelectedMessageKind("normal");
    }
    const existingPreview = !$("mediaPreviewOverlay").classList.contains("hidden") ? STATE.pendingUploadFiles : [];
    const combined = [...existingPreview, ...chosen];
    const seen = new Set();
    STATE.pendingUploadFiles = combined.filter((file) => {
      const key = `${file.name}|${file.size}|${file.lastModified}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    STATE.pendingUploadFile = STATE.pendingUploadFiles[0] || null;
    if (STATE.pendingPreviewUrls?.length) STATE.pendingPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
    STATE.pendingPreviewUrls = STATE.pendingUploadFiles.map((file) => URL.createObjectURL(file));
    STATE.pendingPreviewUrl = STATE.pendingPreviewUrls[0] || null;
    STATE.pendingImageRotation = 0;

    const stage = $("previewMediaWrapper");
    const image = $("imagePreviewElement");
    const video = $("videoPreviewElement");
    const editor = $("imageEditorBar");
    let grid = $("multiMediaPreviewGrid");
    if (!grid) {
      grid = document.createElement("div");
      grid.id = "multiMediaPreviewGrid";
      grid.className = "multi-media-preview-grid hidden";
      stage.appendChild(grid);
    }
    const onlySingleMedia = STATE.pendingUploadFiles.length === 1 && isMediaFile(STATE.pendingUploadFiles[0]);
    grid.innerHTML = "";
    grid.classList.toggle("hidden", onlySingleMedia);
    image.classList.toggle("hidden", !onlySingleMedia || STATE.pendingUploadFiles[0].type.startsWith("video/"));
    video.classList.toggle("hidden", !onlySingleMedia || !STATE.pendingUploadFiles[0].type.startsWith("video/"));
    editor.classList.toggle("hidden", !onlySingleMedia || STATE.pendingUploadFiles[0].type.startsWith("video/"));
    if (onlySingleMedia) {
      const file = STATE.pendingUploadFiles[0];
      if (file.type.startsWith("video/")) {
        video.pause();
        video.src = STATE.pendingPreviewUrl;
        image.removeAttribute("src");
      } else {
        image.src = STATE.pendingPreviewUrl;
        image.style.transform = "rotate(0deg)";
        video.pause();
        video.removeAttribute("src");
      }
    } else {
      image.removeAttribute("src");
      video.pause();
      video.removeAttribute("src");
      STATE.pendingUploadFiles.forEach((file, index) => {
        const tile = document.createElement("div");
        tile.className = "multi-media-preview-tile";
        if (isMediaFile(file)) {
          const element = file.type.startsWith("video/") ? document.createElement("video") : document.createElement("img");
          element.className = "multi-media-preview-item";
          element.src = STATE.pendingPreviewUrls[index];
          if (element.tagName === "VIDEO") { element.muted = true; element.playsInline = true; element.preload = "metadata"; }
          else element.alt = file.name;
          tile.appendChild(element);
        } else {
          const fileCard = document.createElement("div");
          fileCard.className = "preview-file-tile";
          fileCard.textContent = fileKindLabel(file);
          tile.appendChild(fileCard);
        }
        const label = document.createElement("span");
        label.textContent = `${fileKindLabel(file)} · ${file.name}`;
        tile.appendChild(label);
        grid.appendChild(tile);
      });
    }
    const count = STATE.pendingUploadFiles.length;
    const title = $("mediaPreviewOverlay").querySelector(".modal-title");
    if (title) title.textContent = count === 1 ? "Send attachment" : `Send ${count} attachments`;
    $("btnConfirmSendMedia").innerHTML = `<span>Send ${count} item${count === 1 ? "" : "s"}</span><span>➤</span>`;
    $("mediaPreviewOverlay").classList.remove("hidden");
  };

  handleFileSelected = function (event) {
    closeModal("fileChooserOverlay");
    prepareMediaFiles(Array.from(event.target.files || []));
    event.target.value = "";
  };
  handleDocumentFileSelected = function (event) {
    closeModal("fileChooserOverlay");
    prepareMediaFiles(Array.from(event.target.files || []));
    event.target.value = "";
  };
  handleGifFileSelected = function (event) {
    closeModal("fileChooserOverlay");
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    const invalid = files.find((file) => file.type !== "image/gif" && !/\.gif$/i.test(file.name));
    if (invalid) return showToast("Choose GIF files only.");
    STATE.pendingUploadKind = "gif";
    prepareMediaFiles(files);
  };

  cancelMediaPreview = function () {
    base.cancelMediaPreview();
    STATE.pendingUploadKind = "normal";
    STATE.pendingUploadFiles = [];
    STATE.pendingPreviewFiles = [];
  };

  prepareArtForSending = function () {
    const canvas = $("artCanvas");
    const output = document.createElement("canvas");
    output.width = canvas.width;
    output.height = canvas.height;
    const context = output.getContext("2d");
    context.fillStyle = $("artBackground").value;
    context.fillRect(0, 0, output.width, output.height);
    context.drawImage(canvas, 0, 0);
    output.toBlob((blob) => {
      if (!blob) return showToast("Could not create the artwork image.");
      const file = new File([blob], `art_${Date.now()}.png`, { type: "image/png" });
      closeModal("artEditorOverlay");
      STATE.pendingUploadKind = "art";
      prepareMediaFiles([file]);
    }, "image/png");
  };

  async function uploadAndSendMediaEnhanced() {
    const files = [...(STATE.pendingUploadFiles || [])];
    if (!files.length || STATE.isUploading) return;
    if (!STATE.currentUser || !STATE.roomId) return showToast("Please sign in again before sending attachments.");
    if (STATE.selectedMessageKind !== "normal") return showToast("Attachments use the Normal message type.");
    const validation = validateFeatureComposer();
    if (!validation.ok) return;
    const featureMeta = validation.meta;
    const kind = STATE.pendingUploadKind === "art" || STATE.pendingUploadKind === "gif" ? STATE.pendingUploadKind : "normal";
    if (kind === "art" && files.length !== 1) return showToast("Send one artwork at a time.");
    if (kind === "gif" && files.some((file) => file.type !== "image/gif" && !/\.gif$/i.test(file.name))) return showToast("GIF uploads can contain GIF files only.");

    STATE.isUploading = true;
    const sendButton = $("btnConfirmSendMedia");
    setLoading(sendButton, true, "Uploading…");
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    startUploadStatus(totalBytes, `Uploading ${files.length} attachment${files.length === 1 ? "" : "s"}`);
    const mediaItems = [];
    const fileItems = [];
    const uploadedPaths = [];
    const replyToId = STATE.replyTargetMessage?.id || null;
    try {
      const progressByIndex = new Array(files.length).fill(0);
      const uploadedItems = new Array(files.length);
      let nextIndex = 0;
      let uploadFailure = null;
      const uploadWorker = async () => {
        while (nextIndex < files.length && !uploadFailure) {
          const i = nextIndex++;
          const file = files[i];
          const safeName = String(file.name || `attachment-${Date.now()}`).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").slice(0, 180) || "attachment";
          const isMedia = isMediaFile(file);
          const bucket = CONFIG.STORAGE.MEDIA_BUCKET;
          const path = `${STATE.roomId}/${Date.now()}_${i}_${safeName}`;
          uploadedPaths.push(path);
          try {
            await uploadStorageFileWithProgress(bucket, path, file, (loaded) => {
              progressByIndex[i] = Math.max(0, Number(loaded) || 0);
              updateUploadStatus(progressByIndex.reduce((sum, value) => sum + value, 0), totalBytes, `Uploading ${i + 1}/${files.length}`);
            });
            const common = { storage_path: path, file_name: safeName, mime_type: file.type || "application/octet-stream", file_size: file.size };
            uploadedItems[i] = isMedia
              ? { ...common, message_type: file.type.startsWith("video/") ? "video" : "image" }
              : { ...common, message_type: "file" };
            progressByIndex[i] = file.size;
            updateUploadStatus(progressByIndex.reduce((sum, value) => sum + value, 0), totalBytes, `Uploaded ${i + 1}/${files.length}`);
          } catch (error) {
            uploadFailure = error;
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, files.length) }, () => uploadWorker()));
      if (uploadFailure) throw uploadFailure;
      uploadedItems.forEach((item) => {
        if (item.message_type === "file") fileItems.push(item);
        else mediaItems.push(item);
      });
      STATE.uploadCompletedBytes = totalBytes;
      STATE.uploadLastLoaded = totalBytes;
      const elapsed = finishUploadStatus(true);
      const messageItems = [];
      if (mediaItems.length === 1) {
        messageItems.push({ ...mediaItems[0], content: null });
      } else if (mediaItems.length > 1) {
        messageItems.push({
          message_type: "image",
          storage_path: mediaItems[0].storage_path,
          mime_type: "application/x-rs-media-group",
          file_name: `${mediaItems.length} media items`,
          content: JSON.stringify({ __rs_media_group_v1: true, items: mediaItems })
        });
      }
      fileItems.forEach((item) => messageItems.push({ ...item, content: null }));
      const { data, error } = await STATE.supabase.rpc("create_chat_attachment_batch", {
        p_items: messageItems,
        p_reply_to_id: replyToId,
        p_message_kind: kind,
        p_is_urgent: featureMeta.is_urgent,
        p_is_surprise: featureMeta.is_surprise,
        p_scheduled_for: featureMeta.scheduled_for
      });
      if (error) throw error;
      (data || []).forEach((message) => appendMessageToStateAndDom({ ...message, upload_duration_seconds: elapsed }, true));
      if (replyToId) cancelReplyState();
      const count = files.length;
      cancelMediaPreview();
      if (featureMeta.scheduled_for) showToast(`${count} attachment${count === 1 ? "" : "s"} scheduled`);
      else showToast(`${count} attachment${count === 1 ? "" : "s"} sent · ${formatUploadClock(elapsed)}`);
      if (featureMeta.scheduled_for) openScheduledGallery();
      resetComposerFeatureSettings();
    } catch (error) {
      console.error("Attachment batch upload/send", error);
      finishUploadStatus(false);
      if (uploadedPaths.length) {
        try { await STATE.supabase.storage.from(CONFIG.STORAGE.MEDIA_BUCKET).remove(uploadedPaths); }
        catch (cleanupError) { console.warn("Orphan cleanup failed", cleanupError); }
      }
      showToast(getSendErrorMessage(error, "Attachment send"));
    } finally {
      STATE.isUploading = false;
      setLoading(sendButton, false);
    }
  }
  uploadAndSendMedia = uploadAndSendMediaEnhanced;

  openMediaGallery = async function () {
    const grid = $("mediaGalleryGrid");
    grid.innerHTML = "";
    const list = [];
    for (const message of STATE.messages) {
      if (message.is_deleted_everyone || (message.scheduled_for && !message.delivered_at) || message.message_kind === "art" || message.message_kind === "gif") continue;
      if (!(message.message_type === "image" || message.message_type === "video")) continue;
      const isGif = (item) => (item.mime_type || "").toLowerCase() === "image/gif" || /\.gif$/i.test(item.file_name || "");
      const group = getMediaGroup(message);
      if (group) group.items.filter((item) => !isGif(item)).forEach((item) => list.push({ ...item, galleryKind: "media" }));
      else if (!isGif(message)) list.push(message);
    }
    if (!list.length) grid.innerHTML = '<p class="empty-state">No shared media yet</p>';
    else {
      const fragment = document.createDocumentFragment();
      for (const item of list) {
        const type = item.message_type || ((item.mime_type || "").startsWith("video/") ? "video" : "image");
        const card = document.createElement("div");
        card.className = "gallery-card";
        const element = type === "video" ? document.createElement("video") : document.createElement("img");
        element.className = "gallery-thumb-item";
        if (element.tagName === "VIDEO") { element.muted = true; element.controls = false; element.playsInline = true; element.preload = "metadata"; }
        loadAuthorizedMediaUrl(item.storage_path, CONFIG.STORAGE.MEDIA_BUCKET).then((url) => { if (url) element.src = url; });
        element.onclick = () => element.src && openFullscreenMedia(element.src, type, item.file_name);
        const download = document.createElement("a");
        download.className = "gallery-download";
        download.href = "#";
        download.textContent = "↓";
        download.onclick = (event) => { event.preventDefault(); downloadStorageFile(item.storage_path, CONFIG.STORAGE.MEDIA_BUCKET, item.file_name || "media"); };
        card.append(element, download);
        fragment.appendChild(card);
      }
      grid.appendChild(fragment);
    }
    $("mediaGalleryOverlay").classList.remove("hidden");
  };

  async function openArtGallery() {
    const grid = $("artGalleryGrid");
    grid.innerHTML = "";
    const artwork = STATE.messages.filter((message) => !message.is_deleted_everyone && !(message.scheduled_for && !message.delivered_at) && message.message_kind === "art" && message.storage_path);
    if (!artwork.length) grid.innerHTML = '<p class="empty-state">No artwork yet</p>';
    else {
      const fragment = document.createDocumentFragment();
      artwork.forEach((message) => {
        const card = document.createElement("div");
        card.className = "gallery-card art-gallery-card";
        const image = document.createElement("img");
        image.className = "gallery-thumb-item";
        image.alt = "Shared artwork";
        loadAuthorizedMediaUrl(message.storage_path, CONFIG.STORAGE.MEDIA_BUCKET).then((url) => { if (url) image.src = url; });
        image.onclick = () => image.src && openFullscreenMedia(image.src, "image", message.file_name || "artwork.png");
        const meta = document.createElement("small");
        meta.className = "art-gallery-meta";
        meta.textContent = `${message.sender_key === STATE.currentUser.key ? STATE.currentUser.name : STATE.counterpartUser.name} · ${new Date(message.created_at).toLocaleDateString("en-GB")}`;
        card.append(image, meta);
        fragment.appendChild(card);
      });
      grid.appendChild(fragment);
    }
    $("artGalleryOverlay").classList.remove("hidden");
  }

  async function openScheduledGallery() {
    const list = $("scheduledGalleryList");
    list.innerHTML = "";
    try {
      const { data, error } = await STATE.supabase.from("messages").select("*")
        .eq("room_id", STATE.roomId).eq("sender_key", STATE.currentUser.key)
        .not("scheduled_for", "is", null).is("delivered_at", null)
        .eq("is_deleted_everyone", false).order("scheduled_for", { ascending: true });
      if (error) throw error;
      const rows = data || [];
      if (!rows.length) list.innerHTML = '<p class="empty-state">No scheduled messages</p>';
      rows.forEach((message) => {
        const item = document.createElement("article");
        item.className = "scheduled-gallery-item";
        const title = document.createElement("strong");
        title.textContent = message.message_kind === "poll" ? `Poll · ${message.content || "Untitled"}` : message.message_kind === "countdown" ? `Timer · ${message.content || "Untitled"}` : getMessageReplyPreview(message);
        const time = document.createElement("small");
        time.textContent = `Delivering ${new Date(message.scheduled_for).toLocaleString("en-GB")}`;
        const type = document.createElement("span");
        type.className = "scheduled-type-chip";
        type.textContent = message.message_kind || "normal";
        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "btn-subtle";
        edit.textContent = "Edit";
        edit.onclick = () => openScheduledEdit(message);
        item.append(type, title, time, edit);
        list.appendChild(item);
      });
    } catch (error) {
      console.error("Scheduled message gallery", error);
      list.innerHTML = '<p class="empty-state">Could not load scheduled messages. Apply 4.sql first.</p>';
    }
    $("scheduledGalleryOverlay").classList.remove("hidden");
  }

  function openScheduledEdit(message) {
    STATE.scheduledEditId = message.id;
    $("scheduledEditContent").value = (message.message_type === "text" || message.message_type === "link") ? (message.content || "") : "";
    $("scheduledEditUrgent").checked = !!message.is_urgent;
    $("scheduledEditSurprise").checked = !!message.is_surprise;
    $("scheduledEditContent").placeholder = message.message_type === "file" || message.message_type === "image" || message.message_type === "video" ? "Attachment content cannot be replaced here; update the delivery time." : "Message content";
    $("scheduledEditFor").value = localDateTimeValue(message.scheduled_for);
    $("scheduledEditPollFields")?.classList.toggle("hidden", message.message_kind !== "poll");
    $("scheduledEditTimerFields")?.classList.toggle("hidden", message.message_kind !== "countdown");
    $("scheduledEditPollOptions").innerHTML = "";
    if (message.message_kind === "poll") {
      const options = pollVoteRowsFor(message.id).options;
      options.forEach((option, index) => {
        const input = document.createElement("input");
        input.className = "scheduled-poll-option-input";
        input.maxLength = 100;
        input.value = option.option_text;
        input.placeholder = `Option ${index + 1}`;
        $("scheduledEditPollOptions").appendChild(input);
      });
    }
    if (message.message_kind === "countdown" && message.feature_data?.target_at) {
      $("scheduledEditTimerTarget").value = localDateTimeValue(message.feature_data.target_at);
    } else if ($("scheduledEditTimerTarget")) $("scheduledEditTimerTarget").value = "";
    $("scheduledEditOverlay").classList.remove("hidden");
  }

  async function saveScheduledEdit() {
    const message = STATE.messageById.get(STATE.scheduledEditId);
    if (!message) return showToast("Scheduled message is no longer available.");
    const scheduleValue = fromLocalDateTime($("scheduledEditFor").value);
    if (!scheduleValue || new Date(scheduleValue).getTime() <= Date.now()) return showToast("Choose a future delivery date and time.");
    const contentValue = $("scheduledEditContent").value;
    const canEditContent = message.message_type === "text" || message.message_type === "link";
    let pollOptions = null;
    let featureData = { ...(message.feature_data || {}) };
    if (message.message_kind === "poll") {
      pollOptions = [...$("scheduledEditPollOptions").querySelectorAll("input")].map((input) => input.value.trim()).filter(Boolean);
      if (pollOptions.length < 2 || pollOptions.length > 10 || new Set(pollOptions.map((v) => v.toLowerCase())).size !== pollOptions.length || pollOptions.some((v) => v.length > 100)) {
        return showToast("A poll needs 2–10 unique options (100 characters max each).");
      }
    }
    if (message.message_kind === "countdown") {
      const target = fromLocalDateTime($("scheduledEditTimerTarget").value);
      const requiresTarget = featureData.mode !== "countup" || !featureData.infinite;
      if (requiresTarget && !target) return showToast("Choose a timer target before saving this scheduled timer.");
      if (target && new Date(target).getTime() <= new Date(scheduleValue).getTime()) {
        return showToast("The timer target must be after its scheduled start time.");
      }
      featureData.target_at = target;
    }
    const button = $("btnSaveScheduledEdit");
    setLoading(button, true, "Saving…");
    try {
      const { data, error } = await STATE.supabase.rpc("update_scheduled_chat_message", {
        p_message_id: message.id,
        p_content: canEditContent ? contentValue : null,
        p_scheduled_for: scheduleValue,
        p_feature_data: featureData,
        p_is_urgent: $("scheduledEditUrgent").checked,
        p_is_surprise: $("scheduledEditSurprise").checked,
        p_poll_options: pollOptions
      });
      if (error) throw error;
      const updated = Array.isArray(data) ? data[0] : data;
      Object.assign(message, updated || {
        scheduled_for: scheduleValue,
        content: canEditContent ? contentValue : message.content,
        feature_data: featureData,
        is_urgent: $("scheduledEditUrgent").checked,
        is_surprise: $("scheduledEditSurprise").checked
      });
      STATE.messageById.set(message.id, message);
      renderSingleMessage(message.id);
      if (message.message_kind === "poll") await loadPollData(message.id);
      closeModal("scheduledEditOverlay");
      await openScheduledGallery();
      showToast("Scheduled message updated.");
    } catch (error) {
      console.error("Update scheduled message", error);
      showToast(error.message || "Could not update this scheduled message.");
    } finally { setLoading(button, false); }
  }

  openMessageInfoModal = function () {
    base.openMessageInfoModal();
    const message = STATE.messageById.get(STATE.selectedMessageId);
    if (!message) return;
    const body = $("messageInfoContent");
    const addInfo = (label, value) => {
      const row = document.createElement("div");
      row.className = "message-info-row";
      const key = document.createElement("span");
      key.className = "message-info-label";
      key.textContent = label;
      const content = document.createElement("strong");
      content.className = "message-info-value";
      content.textContent = String(value ?? "—");
      row.append(key, content);
      body.appendChild(row);
    };
    addInfo("Message type", ({ poll: "Poll", countdown: "Countdown / Count-up", art: "Art", gif: "GIF" })[message.message_kind] || "Normal");
    const group = getMediaGroup(message);
    addInfo("Content format", group ? `Multiple media items (${group.items.length})` : ({ text: "Text", link: "Link", image: "Image", video: "Video", voice: "Voice", file: "File" })[message.message_type] || message.message_type || "—");
    if (message.message_type === "text" || message.message_type === "link") addInfo("Message content", message.content || "");
    if (message.message_kind === "art") addInfo("Gallery", "Art Gallery only");
    if (message.message_kind === "gif") addInfo("Gallery", "GIFs are not saved to a gallery");
    if (message.is_urgent) addInfo("Urgent", "Yes");
    if (message.is_surprise) addInfo("Surprise", "Yes");
    if (message.scheduled_for) addInfo("Scheduled for", new Date(message.scheduled_for).toLocaleString("en-GB"));
    if (message.delivered_at) addInfo("Delivered at", new Date(message.delivered_at).toLocaleString("en-GB"));
    if (message.message_kind === "poll") {
      const data = pollVoteRowsFor(message.id);
      addInfo("Poll votes", data.votes.length);
      addInfo("Multiple choices", message.feature_data?.allow_multiple ? "Allowed" : "One choice");
    }
    if (message.message_kind === "countdown") {
      addInfo("Timer status", timerText(message));
      if (message.feature_data?.target_at) addInfo("Target", new Date(message.feature_data.target_at).toLocaleString("en-GB"));
    }
  };

  async function copyMessageInfo() {
    const content = [...$("messageInfoContent").querySelectorAll(".message-info-row")]
      .map((row) => `${row.querySelector(".message-info-label")?.textContent || ""}: ${row.querySelector(".message-info-value")?.textContent || ""}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(content);
      showToast("Message information copied.");
    } catch {
      const helper = document.createElement("textarea");
      helper.value = content;
      document.body.appendChild(helper);
      helper.select();
      const ok = document.execCommand("copy");
      helper.remove();
      showToast(ok ? "Message information copied." : "Clipboard access is unavailable.");
    }
  }

  function openGifPicker() {
    STATE.giphySelected.clear();
    renderGiphySelectionCount();
    $("gifSearchInput").value = "";
    $("gifPickerOverlay").classList.remove("hidden");
    if (STATE.giphyTrendingCache.data.length && STATE.giphyTrendingCache.expires > Date.now()) {
      renderGiphyResults(STATE.giphyTrendingCache.data);
      $("gifSearchStatus").textContent = "Trending · cached";
    } else {
      loadGiphyTrending();
    }
  }

  function giphyUrl(endpoint, query = "") {
    const params = new URLSearchParams({ api_key: GIPHY_API_KEY, limit: String(GIPHY_LIMIT), rating: "g", bundle: "messaging_non_clips" });
    if (query) params.set("q", query);
    return `https://api.giphy.com/v1/gifs/${endpoint}?${params.toString()}`;
  }

  async function loadGiphyTrending() {
    if (STATE.giphyTrendingCache.data.length && STATE.giphyTrendingCache.expires > Date.now()) {
      renderGiphyResults(STATE.giphyTrendingCache.data);
      return;
    }
    if (STATE.giphyTrendingPromise) return STATE.giphyTrendingPromise;
    $("gifSearchStatus").textContent = "Loading trending…";
    STATE.giphyTrendingPromise = (async () => {
    try {
      const response = await fetch(giphyUrl("trending"), { cache: "no-store" });
      if (!response.ok) throw new Error(`GIPHY returned ${response.status}`);
      const payload = await response.json();
      const data = Array.isArray(payload.data) ? payload.data.slice(0, GIPHY_LIMIT) : [];
      STATE.giphyTrendingCache = { data, expires: Date.now() + GIPHY_TRENDING_TTL };
      if (!$("gifSearchInput").value.trim()) {
        $("gifSearchStatus").textContent = "Trending";
        renderGiphyResults(data);
      }
    } catch (error) {
      console.error("GIPHY trending", error);
      $("gifSearchStatus").textContent = "Could not load GIFs";
      $("gifResultsGrid").innerHTML = '<p class="empty-state">GIPHY is temporarily unavailable. Try again or upload a GIF.</p>';
    } finally {
      STATE.giphyTrendingPromise = null;
    }
    })();
    return STATE.giphyTrendingPromise;
  }

  function onGiphySearchInput() {
    clearTimeout(STATE.giphySearchTimer);
    if (STATE.giphySearchController) STATE.giphySearchController.abort();
    const query = $("gifSearchInput").value.trim().slice(0, 50);
    STATE.giphySearchTimer = setTimeout(() => {
      if (!query) {
        if (STATE.giphyTrendingCache.data.length && STATE.giphyTrendingCache.expires > Date.now()) {
          $("gifSearchStatus").textContent = "Trending · cached";
          renderGiphyResults(STATE.giphyTrendingCache.data);
        } else loadGiphyTrending();
      } else searchGiphy(query);
    }, 500);
  }

  async function searchGiphy(query) {
    const cacheKey = query.toLowerCase();
    const cached = STATE.giphySearchCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      $("gifSearchStatus").textContent = `Results for “${query}” · cached`;
      renderGiphyResults(cached.data);
      return;
    }
    const controller = new AbortController();
    STATE.giphySearchController = controller;
    $("gifSearchStatus").textContent = `Searching “${query}”…`;
    try {
      const response = await fetch(giphyUrl("search", query), { signal: controller.signal });
      if (!response.ok) throw new Error(`GIPHY returned ${response.status}`);
      const payload = await response.json();
      if (controller.signal.aborted || $("gifSearchInput").value.trim().toLowerCase() !== cacheKey) return;
      const data = Array.isArray(payload.data) ? payload.data.slice(0, GIPHY_LIMIT) : [];
      STATE.giphySearchCache.set(cacheKey, { data, expires: Date.now() + 5 * 60 * 1000 });
      $("gifSearchStatus").textContent = `${data.length} results for “${query}”`;
      renderGiphyResults(data);
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error("GIPHY search", error);
      $("gifSearchStatus").textContent = "Search failed";
      $("gifResultsGrid").innerHTML = '<p class="empty-state">Search could not be completed. Please try again.</p>';
    }
  }

  function renderGiphyResults(items) {
    STATE.giphyItems = items || [];
    const grid = $("gifResultsGrid");
    grid.innerHTML = "";
    if (!STATE.giphyItems.length) {
      grid.innerHTML = '<p class="empty-state">No GIFs found.</p>';
      return;
    }
    const fragment = document.createDocumentFragment();
    STATE.giphyItems.forEach((gif) => {
      const imageUrl = gif.images?.fixed_height?.url || gif.images?.downsized_medium?.url || gif.images?.preview_gif?.url || gif.images?.original?.url || gif.images?.fixed_height_small?.url;
      const sendUrl = gif.images?.original?.url || gif.images?.downsized_large?.url;
      const button = document.createElement("button");
      button.type = "button";
      button.disabled = !sendUrl;
      button.className = `gif-result-card${STATE.giphySelected.has(gif.id) ? " is-selected" : ""}`;
      button.setAttribute("aria-label", STATE.giphySelected.has(gif.id) ? "Remove GIF from selection" : "Select GIF");
      if (imageUrl) {
        const image = document.createElement("img");
        image.loading = "lazy";
        image.decoding = "async";
        image.src = imageUrl;
        image.alt = gif.title || "GIF";
        button.appendChild(image);
      } else {
        const fallback = document.createElement("span");
        fallback.className = "gif-result-fallback";
        fallback.textContent = "Preview unavailable";
        button.appendChild(fallback);
      }
      const check = document.createElement("span");
      check.className = "gif-select-check";
      check.textContent = STATE.giphySelected.has(gif.id) ? "✓" : "+";
      button.appendChild(check);
      button.onclick = () => {
        if (STATE.giphySelected.has(gif.id)) STATE.giphySelected.delete(gif.id);
        else STATE.giphySelected.set(gif.id, gif);
        renderGiphySelectionCount();
        button.classList.toggle("is-selected", STATE.giphySelected.has(gif.id));
        check.textContent = STATE.giphySelected.has(gif.id) ? "✓" : "+";
      };
      fragment.appendChild(button);
    });
    grid.appendChild(fragment);
  }

  function renderGiphySelectionCount() {
    const count = STATE.giphySelected.size;
    $("gifSelectionCount").textContent = `${count} selected`;
    $("btnSendSelectedGifs").disabled = count === 0;
    $("btnSendSelectedGifs").textContent = count ? `Send ${count} GIF${count === 1 ? "" : "s"}` : "Send selected GIFs";
  }

  async function sendSelectedGifs() {
    const selected = [...STATE.giphySelected.values()];
    if (!selected.length) return;
    const button = $("btnSendSelectedGifs");
    setLoading(button, true, "Preparing…");
    try {
      const files = new Array(selected.length);
      let nextGif = 0;
      let downloadError = null;
      const downloadWorker = async () => {
        while (nextGif < selected.length && !downloadError) {
          const index = nextGif++;
          const gif = selected[index];
          const url = gif.images?.original?.url || gif.images?.downsized_large?.url;
          if (!url) continue;
          try {
            const response = await fetch(url, { mode: "cors" });
            if (!response.ok) throw new Error("GIPHY could not provide this GIF file.");
            const blob = await response.blob();
            const file = new File([blob], `giphy_${gif.id || Date.now()}_${index}.gif`, { type: "image/gif" });
            if (file.size > MAX_UPLOAD_BYTES) throw new Error("One selected GIF is larger than 80 MB.");
            files[index] = file;
          } catch (error) { downloadError = error; }
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, selected.length) }, () => downloadWorker()));
      if (downloadError) throw downloadError;
      files.splice(0, files.length, ...files.filter(Boolean));
      if (!files.length) throw new Error("No usable GIFs were selected.");
      STATE.pendingUploadKind = "gif";
      closeModal("gifPickerOverlay");
      prepareMediaFiles(files);
      STATE.giphySelected.clear();
      renderGiphySelectionCount();
    } catch (error) {
      console.error("GIPHY selection download", error);
      showToast(error.message || "Could not prepare selected GIFs.");
    } finally { setLoading(button, false); }
  }

  // Save a draft as soon as the document is backgrounded or closed; the local
  // recovery copy is written synchronously on every keystroke as a fallback.
  window.addEventListener("pagehide", () => {
    clearTimeout(STATE.draftTimeoutId);
    persistDraftToSupabase($("messageTextArea")?.value || "");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && STATE.currentUser) {
      clearTimeout(STATE.draftTimeoutId);
      persistDraftToSupabase($("messageTextArea")?.value || "");
    }
  });

  // Add a small PWA/app identity and avoid carrying the former project label.
  document.title = "Essential";
})();
