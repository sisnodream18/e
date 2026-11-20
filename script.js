/* Essential — real-time Supabase chat controller */
const CONFIG={APP_NAME:"Essential",SUPABASE_URL:"https://qbsfpvzcnhauynukeiim.supabase.co",SUPABASE_PUBLISHABLE_KEY:"sb_publishable_aEM5RnS2FTnVH_WSIkvmUA_ebSP7APC",STORAGE:{MEDIA_BUCKET:"chat-media",VOICE_BUCKET:"chat-voice"},IDENTITIES:{FIRST:{key:"first",name:"Thyme",pfp:"./thyme.jpg"},SECOND:{key:"second",name:"Inaya",pfp:"./inaya.jpg"}},PRESENCE_STALE_MS:45000,URL_TTL:330,MESSAGE_EDIT_DELETE_WINDOW_MINUTES:15,MESSAGE_EDIT_DELETE_WINDOW_MS:15*60*1000};
const STATE={supabase:null,selectedIdentityKey:null,currentUser:null,counterpartUser:null,roomId:null,messages:[],messageById:new Map(),selectedMessageId:null,replyTargetMessage:null,replyJumpTimerId:null,editingMessageId:null,realtimeChannel:null,heartbeatIntervalId:null,activeAudioPlayer:null,activeAudioUI:null,mediaRecorder:null,audioChunks:[],recordingTimerId:null,recordingStartTime:0,recordingPausedAt:0,recordingPausedTotal:0,pendingUploadFile:null,pendingUploadFiles:[],pendingPreviewUrl:null,pendingPreviewUrls:[],pendingImageRotation:0,mediaUrlCache:new Map(),presenceBootstrapped:false,typingTimeoutId:null,typingStopTimeoutId:null,isTyping:false,counterpartTyping:false,counterpartRecording:false,renderQueued:false,isUploading:false,toastTimer:null,seenByCounterpart:new Set(),seenMessageIds:new Set(),pendingSeenMessageIds:new Set(),seenObserver:null,seenSchemaWarningShown:false,pendingDocumentFile:null,isUploadingDocument:false,isSendingMessage:false,pendingNewMessagesBelow:0,uploadStartedAt:0,uploadTimerId:null,uploadTotalBytes:0,uploadCompletedBytes:0,uploadLastProgressAt:0,uploadLastLoaded:0,uploadDurationSeconds:0,artTool:"pen",artHistory:[],artDrawing:false,artLastPoint:null};
const $=id=>document.getElementById(id);const esc=s=>String(s??"");

document.addEventListener("DOMContentLoaded",initApp);
async function initApp(){
  STATE.supabase=window.supabase.createClient(CONFIG.SUPABASE_URL,CONFIG.SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:false}});
  bindIdentityUI();setupEventListeners();showScreen("loginScreen");
}
function bindIdentityUI(){const a=CONFIG.IDENTITIES.FIRST,b=CONFIG.IDENTITIES.SECOND;$("nameFirstCard").textContent=a.name;$("pfpFirstCard").src=a.pfp;$("nameSecondCard").textContent=b.name;$("pfpSecondCard").src=b.pfp;}
function showScreen(id){document.querySelectorAll(".screen").forEach(s=>s.classList.add("hidden"));$(id).classList.remove("hidden");}
function showToast(message){const t=$("toast");t.textContent=message;t.classList.remove("hidden");clearTimeout(STATE.toastTimer);STATE.toastTimer=setTimeout(()=>t.classList.add("hidden"),2800);}
function setLoading(button,busy,label){if(!button)return;button.disabled=busy;button.dataset.oldText=button.dataset.oldText||button.textContent;if(busy)button.textContent=label||"Working…";else button.textContent=button.dataset.oldText;}

function setupEventListeners(){
  $("identityCardFirst").onclick=()=>selectIdentity("first");$("identityCardSecond").onclick=()=>selectIdentity("second");
  $("btnBackToIdentities").onclick=()=>{ $("passwordStep").classList.add("hidden");$("identityStep").classList.remove("hidden");STATE.selectedIdentityKey=null; };
  $("btnTogglePassword").onclick=()=>{const i=$("passwordInput");i.type=i.type==="password"?"text":"password";};
  $("passwordForm").onsubmit=e=>{e.preventDefault();handleLogin();};
  $("btnThreeDots").onclick=e=>{e.stopPropagation();$("threeDotsMenu").classList.toggle("hidden");};
  document.addEventListener("click",()=>{$("threeDotsMenu").classList.add("hidden");dismissFloatingReactionPicker();});
  $("threeDotsMenu").onclick=e=>e.stopPropagation();
  $("btnOpenMediaGallery").onclick=()=>{closeMenus();openMediaGallery();};$("btnOpenVoiceGallery").onclick=()=>{closeMenus();openVoiceGallery();};$("btnOpenPinnedGallery").onclick=()=>{closeMenus();openPinnedGallery();};$("btnClearHistory").onclick=()=>{closeMenus();updateClearRangeControls();$("clearHistoryModal").classList.remove("hidden");};
  $("btnCloseMediaGallery").onclick=()=>closeModal("mediaGalleryOverlay");$("btnCloseVoiceGallery").onclick=()=>closeModal("voiceGalleryOverlay");$("btnClosePinnedGallery").onclick=()=>closeModal("pinnedGalleryOverlay");$("btnCloseArtEditor").onclick=()=>closeModal("artEditorOverlay");$("btnClearArt").onclick=clearArtCanvas;$("btnUndoArt").onclick=undoArtCanvas;$("btnSendArt").onclick=prepareArtForSending;setupArtEditor();$("btnCloseReactionDetails").onclick=()=>closeModal("reactionDetailsModal");$("btnCloseAllReactions").onclick=()=>closeModal("allReactionsModal");$("btnCancelClearHistory").onclick=()=>closeModal("clearHistoryModal");$("btnCancelDeleteDialog").onclick=()=>closeModal("deleteChoicesModal");
  $("btnConfirmClearHistory").onclick=executeClearChatHistory;
  $("btnCloseFileChooser").onclick=()=>closeModal("fileChooserOverlay");$("btnChooseMedia").onclick=()=>openDevicePicker("mediaFileInput");$("btnChooseDocuments").onclick=()=>openDevicePicker("documentFileInput");$("btnChooseGif").onclick=()=>openDevicePicker("gifFileInput");$("btnOpenArtEditor").onclick=()=>{closeModal("fileChooserOverlay");openArtEditor();};
  $("clearRangeMode").onchange=updateClearRangeControls;$("clearRangeAmount").oninput=updateClearRangeControls;$("clearRangeUnit").onchange=updateClearRangeControls;updateClearRangeControls();
  $("btnCloseMessageInfo").onclick=()=>closeModal("messageInfoModal");
  $("btnVideoPlayPause").onclick=toggleViewerVideoPlayback;$("btnVideoMute").onclick=toggleViewerVideoMute;$("videoProgress").oninput=seekViewerVideo;
  $("fullscreenVideo").addEventListener("loadedmetadata",syncViewerVideoControls);$("fullscreenVideo").addEventListener("timeupdate",syncViewerVideoControls);$("fullscreenVideo").addEventListener("play",syncViewerVideoControls);$("fullscreenVideo").addEventListener("pause",syncViewerVideoControls);$("fullscreenVideo").addEventListener("volumechange",syncViewerVideoControls);
  $("btnMoreReactions").onclick=e=>{e.stopPropagation();if(!STATE.selectedMessageId)return;$("allReactionsModal").classList.remove("hidden");};
  $("allEmojiPicker").addEventListener("emoji-click",e=>{e.stopPropagation();const emoji=e.detail?.unicode;if(!emoji||!STATE.selectedMessageId)return;const id=STATE.selectedMessageId;toggleMessageReaction(id,emoji).finally(()=>{closeModal("allReactionsModal");clearMessageSelection();});});
  const ta=$("messageTextArea");ta.addEventListener("input",()=>{onComposerInput();broadcastTypingState(true);});ta.addEventListener("blur",()=>broadcastTypingState(false));// Enter inserts a newline in the textarea. Messages are sent only with the Send button.
  $("btnJumpToLatest").onclick=()=>scrollToBottom(true);$("chatMessages").addEventListener("scroll",handleChatScroll,{passive:true});
  $("btnSendMessage").onclick=handleSendMessage;$("btnAttachMedia").onclick=openFileChooser;$("mediaFileInput").onchange=handleFileSelected;$("gifFileInput").onchange=handleGifFileSelected;$("documentFileInput").onchange=handleDocumentFileSelected;
  $("btnCancelMediaPreview").onclick=cancelMediaPreview;$("btnRotateImage").onclick=rotatePreviewImage;$("btnConfirmSendMedia").onclick=uploadAndSendMedia;
  $("btnCancelFilePreview").onclick=cancelFilePreview;$("btnConfirmSendFile").onclick=uploadAndSendDocument;
  $("btnMicRecord").onclick=startVoiceRecording;$("btnDiscardRecord").onclick=stopAndDiscardRecording;$("btnPauseResumeRecord").onclick=togglePauseRecording;$("btnSendRecord").onclick=stopAndSendRecording;
  $("btnCancelSelection").onclick=clearMessageSelection;$("btnCopySelected").onclick=copySelectedMessage;$("btnInfoSelected").onclick=openMessageInfoModal;$("btnPinSelected").onclick=toggleSelectedMessagePin;$("btnReplySelected").onclick=()=>initiateReply();$("btnEditSelected").onclick=initiateEdit;$("btnDeleteSelected").onclick=openDeleteChoicesModal;
  $("btnDeleteForMe").onclick=executeDeleteForMe;$("btnDeleteForEveryone").onclick=executeDeleteForEveryone;
  $("btnCancelReply").onclick=cancelReplyState;$("btnCancelEdit").onclick=cancelEditState;
  const replyBanner=$("replyPreviewBanner");
  replyBanner.addEventListener("click",e=>{if(e.target.closest("button"))return;if(STATE.replyTargetMessage)jumpToOriginalMessage(STATE.replyTargetMessage.id);});
  const replyBannerContent=replyBanner.querySelector(".context-content");
  if(replyBannerContent){replyBannerContent.setAttribute("role","button");replyBannerContent.setAttribute("tabindex","0");replyBannerContent.setAttribute("aria-label","Jump to replied message");replyBannerContent.addEventListener("keydown",e=>{if((e.key==="Enter"||e.key===" ")&&!e.target.closest("button")){e.preventDefault();if(STATE.replyTargetMessage)jumpToOriginalMessage(STATE.replyTargetMessage.id);}});}
  $("btnCloseFullscreen").onclick=closeFullscreen;$("btnDownloadFullscreen").onclick=e=>{if(!e.currentTarget.href)return;};
  document.querySelectorAll(".reaction-emoji-btn").forEach(b=>b.onclick=e=>{e.stopPropagation();if(STATE.selectedMessageId)toggleMessageReaction(STATE.selectedMessageId,b.dataset.emoji).finally(()=>{dismissFloatingReactionPicker();clearMessageSelection();});});
  window.addEventListener("pagehide",()=>{broadcastTypingState(false);broadcastRecordingState(false);sendHeartbeat(false);});window.addEventListener("beforeunload",()=>{broadcastTypingState(false);broadcastRecordingState(false);sendHeartbeat(false);});document.addEventListener("visibilitychange",()=>{if(STATE.currentUser){sendHeartbeat(!document.hidden);if(!document.hidden)observeVisibleIncomingMessages();}});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"){["fileChooserOverlay","mediaPreviewOverlay","fileUploadPreviewOverlay","fullscreenViewerOverlay","mediaGalleryOverlay","voiceGalleryOverlay","pinnedGalleryOverlay","artEditorOverlay","reactionDetailsModal","allReactionsModal","messageInfoModal","deleteChoicesModal","clearHistoryModal"].forEach(closeModal);clearMessageSelection();}});
}
function closeMenus(){$("threeDotsMenu").classList.add("hidden");}function closeModal(id){const el=$(id);if(el)el.classList.add("hidden");}
function openFileChooser(){$("fileChooserOverlay").classList.remove("hidden");}
function openDevicePicker(inputId){closeModal("fileChooserOverlay");const input=$(inputId);if(input){input.value="";input.click();}}
function isWithinMessageActionWindow(msg){return !!msg&&Date.now()-new Date(msg.created_at).getTime()<=CONFIG.MESSAGE_EDIT_DELETE_WINDOW_MS;}
function updateClearRangeControls(){const mode=$("clearRangeMode").value,wrap=$("clearRangeAmountWrap"),amount=Math.max(1,Math.min(10000,parseInt($("clearRangeAmount").value,10)||1)),unit=$("clearRangeUnit").value;wrap.classList.toggle("hidden",mode==="all");if(mode==="all")$("clearRangeDescription").textContent="Delete every unpinned message and attachment from the conversation. Pinned messages stay safe.";else if(mode==="last")$("clearRangeDescription").textContent=`Delete unpinned messages from the last ${amount} ${unit}. Pinned messages stay safe.`;else $("clearRangeDescription").textContent=`Delete unpinned messages older than the last ${amount} ${unit}, keeping the most recent period and all pinned messages.`;}
function onComposerInput(){const ta=$("messageTextArea");ta.style.height="auto";ta.style.height=Math.min(ta.scrollHeight,126)+"px";const has=ta.value.trim().length>0||!!STATE.editingMessageId;$("btnSendMessage").classList.toggle("hidden",!has);$("btnMicRecord").classList.toggle("hidden",has);}
function selectIdentity(key){STATE.selectedIdentityKey=key;const c=key==="first"?CONFIG.IDENTITIES.FIRST:CONFIG.IDENTITIES.SECOND;$("passwordAvatar").src=c.pfp;$("passwordIdentityName").textContent=c.name;$("passwordInput").value="";$("passwordError").classList.add("hidden");$("identityStep").classList.add("hidden");$("passwordStep").classList.remove("hidden");setTimeout(()=>$("passwordInput").focus(),60);}

async function handleLogin(){const password=$("passwordInput").value.trim();if(!password||!STATE.selectedIdentityKey)return;const submit=$("btnLoginSubmit");setLoading(submit,true,"Entering…");$("passwordError").classList.add("hidden");try{
  let session=(await STATE.supabase.auth.getSession()).data.session;if(!session){const auth=await STATE.supabase.auth.signInAnonymously();if(auth.error)throw auth.error;}
  const {data:isValid,error}=await STATE.supabase.rpc("verify_identity_password",{p_identity_key:STATE.selectedIdentityKey,p_password:password});if(error)throw error;if(!isValid){$("passwordError").classList.remove("hidden");return;}
  STATE.currentUser=STATE.selectedIdentityKey==="first"?CONFIG.IDENTITIES.FIRST:CONFIG.IDENTITIES.SECOND;STATE.counterpartUser=STATE.selectedIdentityKey==="first"?CONFIG.IDENTITIES.SECOND:CONFIG.IDENTITIES.FIRST;
  STATE.seenByCounterpart=new Set();STATE.seenMessageIds=new Set();STATE.pendingSeenMessageIds=new Set();STATE.seenSchemaWarningShown=false;setupSeenObserver();
  // Only the bulk time-range delete is Shadow/Thyme-only. Per-message deletion stays available to both identities.
  $("btnClearHistory").classList.toggle("hidden",STATE.currentUser.key!=="first");
  $("btnDeleteSelected").classList.remove("hidden");
  await loadMessageActionWindowSetting();
  const {data:room,error:roomErr}=await STATE.supabase.from("rooms").select("id").eq("name","permanent_rs_room").single();if(roomErr)throw roomErr;STATE.roomId=room.id;
  $("counterpartPfp").src=STATE.counterpartUser.pfp;$("counterpartName").textContent=STATE.counterpartUser.name;updatePresenceStatusUI(false,null,true);showScreen("chatScreen");
  await Promise.all([loadMessages(),loadCounterpartPresence()]);subscribeRealtime();startPresenceHeartbeat();
 }catch(err){console.error(err);$("passwordError").textContent=err.message||"Unable to enter space.";$("passwordError").classList.remove("hidden");}finally{setLoading(submit,false);}}

async function loadMessages(){const loading=$("messagesLoading");loading.classList.remove("hidden");try{const {data,error}=await STATE.supabase.from("messages").select("*,message_reactions(*),message_visibility(*)").eq("room_id",STATE.roomId).order("created_at",{ascending:true});if(error)throw error;STATE.messages=(data||[]).filter(m=>!m.message_visibility?.some(v=>v.identity_key===STATE.currentUser.key&&v.is_hidden));rebuildMessageMap();await loadSeenReceipts();renderMessagesList(true);}catch(e){console.error(e);showToast("Failed to load messages.");}finally{loading.classList.add("hidden");}}
async function loadSeenReceipts(){try{const {data,error}=await STATE.supabase.from("message_seen_receipts").select("message_id,seen_by_identity_key,seen_at").eq("seen_by_identity_key",STATE.counterpartUser.key);if(error)throw error;STATE.seenByCounterpart=new Set((data||[]).map(r=>r.message_id));}catch(e){console.warn("Seen receipts unavailable; apply the follow-up Supabase migration.",e);if(!STATE.seenSchemaWarningShown){STATE.seenSchemaWarningShown=true;showToast("Seen receipts need the follow-up Supabase SQL migration.");}}}
function rebuildMessageMap(){STATE.messageById.clear();for(const m of STATE.messages)STATE.messageById.set(m.id,m);}
function renderMessagesList(forceBottom=false){if(STATE.renderQueued)return;STATE.renderQueued=true;requestAnimationFrame(()=>{STATE.renderQueued=false;const viewport=$("chatMessages"),c=$("messagesList");const shouldStick=forceBottom||isNearBottom();c.innerHTML="";if(!STATE.messages.length){$("emptyChatState").classList.remove("hidden");updateJumpToLatestButton();return;}$("emptyChatState").classList.add("hidden");let last="";const frag=document.createDocumentFragment();for(const m of STATE.messages){const d=new Date(m.created_at).toDateString();if(d!==last){const s=document.createElement("div");s.className="date-separator";s.textContent=formatDateGroup(new Date(m.created_at));frag.appendChild(s);last=d;}frag.appendChild(createMessageBubbleElement(m));}c.appendChild(frag);observeVisibleIncomingMessages();if(shouldStick){scrollToBottom(false);}else{updateJumpToLatestButton();}});}
function isNearBottom(){const c=$("chatMessages");return c.scrollHeight-c.scrollTop-c.clientHeight<100;}
function handleChatScroll(){if(isNearBottom()){STATE.pendingNewMessagesBelow=0;}updateJumpToLatestButton();}
function updateJumpToLatestButton(){const button=$("btnJumpToLatest");if(!button)return;const count=STATE.pendingNewMessagesBelow||0;button.classList.toggle("hidden",count===0);button.textContent=count>0?`↓ ${count} new message${count===1?"":"s"}`:"↓ Latest messages";button.setAttribute("aria-label",count>0?`Jump to latest messages, ${count} new message${count===1?"":"s"} below`:"Jump to latest messages");}
function formatDateGroup(d){const today=new Date(),y=new Date(today);y.setDate(today.getDate()-1);if(d.toDateString()===today.toDateString())return"Today";if(d.toDateString()===y.toDateString())return"Yesterday";return d.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"});}

function createMessageBubbleElement(msg){const own=msg.sender_key===STATE.currentUser.key,row=document.createElement("div");row.className=`message-row ${own?"own":"counterpart"}`;row.dataset.id=msg.id;row.dataset.createdDate=new Date(msg.created_at).toDateString();row.style.marginBottom="2px";const bubble=document.createElement("div");bubble.className="message-bubble";
  
  if(msg.reply_to_id&&STATE.messageById.has(msg.reply_to_id)){const parent=STATE.messageById.get(msg.reply_to_id),q=document.createElement("div");q.className="reply-reference-quote";q.title="Tap to view original message";q.setAttribute("role","button");q.setAttribute("tabindex","0");q.setAttribute("aria-label","Jump to replied message");const a=document.createElement("span");a.className="reply-reference-author";a.textContent=parent.sender_key===STATE.currentUser.key?STATE.currentUser.name:STATE.counterpartUser.name;const t=document.createElement("div");t.className="reply-reference-preview";setExpandablePreview(t,getMessageReplyPreview(parent),30);q.append(a,t);q.onclick=e=>{if(e.target.closest("button"))return;e.stopPropagation();jumpToOriginalMessage(msg.reply_to_id);};q.onkeydown=e=>{if((e.key==="Enter"||e.key===" ")&&!e.target.closest("button")){e.preventDefault();jumpToOriginalMessage(msg.reply_to_id);}};bubble.appendChild(q);}
  if(msg.is_deleted_everyone){const p=document.createElement("p");p.className="deleted-message";p.textContent="This message was deleted";bubble.appendChild(p);}else if(msg.message_type==="text"||msg.message_type==="link"){const p=document.createElement("p");appendLinkifiedText(p,msg.content||"");bubble.appendChild(p);}else if(msg.message_type==="image"||msg.message_type==="video"){bubble.appendChild(createMediaBlock(msg));}else if(msg.message_type==="voice"){bubble.appendChild(createInlineVoicePlayer(msg));}else if(msg.message_type==="file"){bubble.appendChild(createFileBlock(msg));}
  if(msg.is_pinned){const pin=document.createElement("span"),icon=document.createElement("span");pin.className="message-pinned-indicator";icon.className="pin-symbol";icon.textContent="📌";icon.setAttribute("aria-hidden","true");pin.append(icon,document.createTextNode(" Pinned"));bubble.appendChild(pin);}
  if(Number(msg.upload_duration_seconds)>0){const status=document.createElement("div");status.className="message-upload-duration";status.textContent=`Uploaded in ${formatDuration(msg.upload_duration_seconds)}`;bubble.appendChild(status);}
  
  if(msg.message_reactions?.length){const r=document.createElement("button");r.type="button";r.className="message-reactions-badge";r.textContent=`${[...new Set(msg.message_reactions.map(x=>x.emoji))].join(" ")} ${msg.message_reactions.length}`;r.onclick=e=>{e.stopPropagation();openReactionDetailsModal(msg.message_reactions);};bubble.appendChild(r);}row.appendChild(bubble);
  
  attachBubbleGestureListeners(row,msg);return row;}

function appendLinkifiedText(container,rawText){
  const text=String(rawText||""),re=/(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;let cursor=0,match;
  while((match=re.exec(text))){let raw=match[0],urlText=raw;while(/[),.!?;:]$/.test(urlText))urlText=urlText.slice(0,-1);if(!urlText)continue;container.appendChild(document.createTextNode(text.slice(cursor,match.index)));const href=/^https?:\/\//i.test(urlText)?urlText:`https://${urlText}`;try{const parsed=new URL(href);if(!["http:","https:"].includes(parsed.protocol))throw new Error("Unsafe link");const a=document.createElement("a");a.href=parsed.href;a.textContent=urlText;a.target="_blank";a.rel="noopener noreferrer";a.className="message-link";container.appendChild(a);}catch{container.appendChild(document.createTextNode(urlText));}cursor=match.index+urlText.length;re.lastIndex=cursor;}
  container.appendChild(document.createTextNode(text.slice(cursor)));
}
function getMessageReplyPreview(msg){if(!msg)return"Message unavailable";if(msg.is_deleted_everyone)return"Message deleted";const group=getMediaGroup(msg);if(group)return `Photo/video · ${group.items.length} items`;if(msg.message_type==="text"||msg.message_type==="link")return msg.content||"Message";if(msg.message_type==="image")return msg.content||"Photo";if(msg.message_type==="video")return msg.content||"Video";if(msg.message_type==="voice")return"Voice message";if(msg.message_type==="file")return msg.file_name?`File: ${msg.file_name}`:"File attachment";return msg.content||"Message";}
function setExpandablePreview(container,rawValue,maxChars=30){const rawText=String(rawValue||"");container.innerHTML="";container.classList.add("expandable-preview");const copy=document.createElement("span");copy.className="reply-preview-copy";const toggle=document.createElement("button");toggle.type="button";toggle.className="reply-see-more";let expanded=false;const render=()=>{const long=rawText.length>maxChars;copy.textContent=long&&!expanded?rawText.slice(0,maxChars).trimEnd()+"…":rawText;toggle.textContent=expanded?"See less":"See more";toggle.classList.toggle("hidden",!long);};toggle.onclick=e=>{e.preventDefault();e.stopPropagation();expanded=!expanded;render();};container.append(copy,toggle);render();}
function formatTime(d){return d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"});}

function createMediaBlock(msg){const group=getMediaGroup(msg);if(group){const grid=document.createElement("div");grid.className="chat-media-group-grid";group.items.forEach((item,index)=>{const tile=document.createElement("div");tile.className="chat-media-group-tile";const type=item.message_type||((item.mime_type||"").startsWith("video/")?"video":"image");tile.classList.toggle("is-video-tile",type==="video");const media=type==="video"?document.createElement("video"):document.createElement("img");media.className="chat-media-element chat-media-group-element";media.loading="lazy";if(media.tagName==="VIDEO"){media.controls=false;media.playsInline=true;media.preload="metadata";}else media.alt=item.file_name||"Shared photo";loadAuthorizedMediaUrl(item.storage_path,CONFIG.STORAGE.MEDIA_BUCKET).then(url=>{if(url)media.src=url;});media.onclick=()=>media.src&&openFullscreenMedia(media.src,type,item.file_name);tile.appendChild(media);const dl=document.createElement("button");dl.type="button";dl.className="media-action-btn chat-media-group-download";dl.textContent="↓";dl.title=`Download ${item.file_name||"media"}`;dl.onclick=e=>{e.stopPropagation();downloadStorageFile(item.storage_path,CONFIG.STORAGE.MEDIA_BUCKET,item.file_name||`media-${index+1}`);};tile.appendChild(dl);grid.appendChild(tile);});return grid;}const wrap=document.createElement("div");wrap.className=`media-wrap ${msg.message_type==="video"?"video-wrap":""}`;const media=msg.message_type==="image"?document.createElement("img"):document.createElement("video");media.className="chat-media-element";media.loading="lazy";if(media.tagName==="VIDEO"){media.controls=false;media.playsInline=true;media.preload="metadata";}else media.alt="Shared image";loadAuthorizedMediaUrl(msg.storage_path,CONFIG.STORAGE.MEDIA_BUCKET).then(url=>{if(url)media.src=url;});media.onclick=()=>{if(media.src)openFullscreenMedia(media.src,msg.message_type,msg.file_name);};wrap.appendChild(media);const actions=document.createElement("div");actions.className="media-action-row";const dl=document.createElement("button");dl.type="button";dl.className="media-action-btn";dl.textContent="↓ Download";dl.onclick=e=>{e.stopPropagation();downloadStorageFile(msg.storage_path,CONFIG.STORAGE.MEDIA_BUCKET,msg.file_name||`media-${msg.id}`);};actions.appendChild(dl);wrap.appendChild(actions);if(msg.content){const cap=document.createElement("p");cap.textContent=msg.content;cap.style.marginTop="6px";wrap.appendChild(cap);}return wrap;}

function createFileBlock(msg){const card=document.createElement("div");card.className="shared-file-card";const ext=getFileExtension(msg.file_name);const icon=document.createElement("span");icon.className=`file-type-icon shared-file-icon ${getFileIconClass(ext)}`;icon.textContent=(ext||"FILE").slice(0,5).toUpperCase();const info=document.createElement("div");info.className="shared-file-info";const name=document.createElement("strong");name.className="shared-file-name";name.textContent=msg.file_name||"Shared file";name.title=name.textContent;const details=document.createElement("span");details.className="shared-file-details";details.textContent=[formatBytes(msg.file_size),getFileTypeLabel(msg.mime_type,ext)].filter(Boolean).join(" • ")||"File attachment";info.append(name,details);card.append(icon,info);const dl=document.createElement("button");dl.type="button";dl.className="shared-file-download";dl.textContent="↓ Download";dl.setAttribute("aria-label",`Download ${msg.file_name||"file"}`);dl.onclick=e=>{e.stopPropagation();downloadStorageFile(msg.storage_path,CONFIG.STORAGE.MEDIA_BUCKET,msg.file_name||`file-${msg.id}`);};card.appendChild(dl);return card;}
function getFileExtension(name){const m=String(name||"").match(/\.([a-z0-9]{1,10})$/i);return m?m[1].toLowerCase():"file";}
function getFileIconClass(ext){if(["pdf"].includes(ext))return"file-icon-pdf";if(["doc","docx","odt","rtf"].includes(ext))return"file-icon-doc";if(["xls","xlsx","csv"].includes(ext))return"file-icon-sheet";if(["ppt","pptx"].includes(ext))return"file-icon-slide";if(["apk","exe","msi","dmg","deb","rpm"].includes(ext))return"file-icon-app";if(["zip","rar","7z","tar","gz"].includes(ext))return"file-icon-archive";if(["txt","md","json","xml","html","css","js","py","sql"].includes(ext))return"file-icon-text";return"file-icon-generic";}
function getFileTypeLabel(mime,ext){if(mime&&mime!=="application/octet-stream")return mime;return ext&&ext!=="file"?`${ext.toUpperCase()} file`:"File";}
function formatBytes(bytes){const n=Number(bytes);if(!Number.isFinite(n)||n<0)return"";if(n<1024)return`${n} B`;if(n<1024*1024)return`${(n/1024).toFixed(1)} KB`;if(n<1024*1024*1024)return`${(n/(1024*1024)).toFixed(1)} MB`;return`${(n/(1024*1024*1024)).toFixed(2)} GB`;}

function attachBubbleGestureListeners(row,msg){let sx=0,sy=0,cx=0,cy=0,horizontal=false,moved=false,timer=null;const REPLY_TRIGGER=56;const isVoiceSeek=e=>!!e.target.closest?.(".voice-waveform");const reset=()=>{clearTimeout(timer);timer=null;row.style.transform="";horizontal=false;moved=false;};row.addEventListener("touchstart",e=>{if(isVoiceSeek(e))return;const t=e.touches[0];if(!t)return;sx=cx=t.clientX;sy=cy=t.clientY;horizontal=false;moved=false;clearTimeout(timer);timer=setTimeout(()=>{if(!moved)triggerMessageSelection(msg,row);},460);},{passive:true});row.addEventListener("touchmove",e=>{if(isVoiceSeek(e))return;const t=e.touches[0];if(!t)return;cx=t.clientX;cy=t.clientY;const dx=cx-sx,dy=cy-sy;if(Math.abs(dx)>8||Math.abs(dy)>8)clearTimeout(timer);if(Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)*1.15){horizontal=true;moved=true;clearTimeout(timer);const translate=Math.max(-12,Math.min(78,dx));row.style.transform=`translateX(${translate}px)`;}else if(Math.abs(dy)>12){moved=true;clearTimeout(timer);}},{passive:true});row.addEventListener("touchend",e=>{if(isVoiceSeek(e))return;clearTimeout(timer);const dx=cx-sx;row.style.transform="";const shouldReply=horizontal&&dx>=REPLY_TRIGGER;horizontal=false;moved=false;if(shouldReply)initiateReply(msg);});row.addEventListener("touchcancel",reset);row.addEventListener("contextmenu",e=>{e.preventDefault();triggerMessageSelection(msg,row);});}
function triggerMessageSelection(msg,row){$("btnDeleteSelected").classList.remove("hidden");STATE.selectedMessageId=msg.id;document.querySelectorAll(".message-row").forEach(x=>x.classList.remove("selected-bubble"));row.classList.add("selected-bubble");const own=msg.sender_key===STATE.currentUser.key,ok=isWithinMessageActionWindow(msg);$("btnEditSelected").classList.toggle("hidden",!(own&&msg.message_type==="text"&&ok));$("btnPinSelected").textContent=msg.is_pinned?"📌✓":"📌";$("btnPinSelected").title=msg.is_pinned?"Unpin message":"Pin message";$("btnPinSelected").setAttribute("aria-label",msg.is_pinned?"Unpin message":"Pin message");$("selectionToolbar").classList.remove("hidden");$("normalHeader").classList.add("hidden");positionFloatingReactionPicker(row);}
function positionFloatingReactionPicker(row){const p=$("floatingReactionPicker"),r=row.getBoundingClientRect(),a=$("app").getBoundingClientRect();let top=r.top-a.top-52;if(top<8)top=r.bottom-a.top+8;p.style.top=`${top}px`;p.style.transform="translateX(-50%)";p.classList.remove("hidden");}
function dismissFloatingReactionPicker(){$("floatingReactionPicker").classList.add("hidden");}function clearMessageSelection(){STATE.selectedMessageId=null;document.querySelectorAll(".message-row").forEach(r=>r.classList.remove("selected-bubble"));$("selectionToolbar").classList.add("hidden");$("normalHeader").classList.remove("hidden");dismissFloatingReactionPicker();}

function openMessageInfoModal(){
  const msg=STATE.messageById.get(STATE.selectedMessageId);if(!msg)return;
  const body=$("messageInfoContent");body.innerHTML="";
  const add=(label,value)=>{const row=document.createElement("div");row.className="message-info-row";const k=document.createElement("span");k.className="message-info-label";k.textContent=label;const v=document.createElement("strong");v.className="message-info-value";v.textContent=String(value??"—");row.append(k,v);body.appendChild(row);};
  const own=msg.sender_key===STATE.currentUser.key,stamp=new Date(msg.created_at),group=getMediaGroup(msg);
  const type=group?"Multiple media items":({text:"Text",link:"Link",image:"Photo",video:"Video",voice:"Voice message",file:"File"}[msg.message_type]||msg.message_type);
  const seenText=own?(STATE.seenByCounterpart.has(msg.id)?`Seen by ${STATE.counterpartUser.name}`:`Not seen by ${STATE.counterpartUser.name} yet`):(STATE.seenMessageIds.has(msg.id)?"Seen by you":"Not marked as seen by you yet");
  add("Sender",own?STATE.currentUser.name:STATE.counterpartUser.name);
  add("Date",stamp.toLocaleDateString("en-GB",{weekday:"long",day:"2-digit",month:"long",year:"numeric"}));
  add("Time",stamp.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit"}));
  add("Seen status",seenText);add("Content format",type);add("Pinned",msg.is_pinned?`Yes${msg.pinned_at?` · ${new Date(msg.pinned_at).toLocaleString("en-GB")}`:""}`:"No");if(Number(msg.upload_duration_seconds)>0)add("Upload duration",formatDuration(msg.upload_duration_seconds));add("Edited",msg.is_edited?`Yes${msg.edited_at?` · ${new Date(msg.edited_at).toLocaleString("en-GB")}`:""}`:"No");
  if(msg.file_name)add("File name",msg.file_name);if(msg.file_size!=null&&Number.isFinite(Number(msg.file_size)))add("File size",formatBytes(msg.file_size));if(msg.mime_type)add("File type",msg.mime_type);if(msg.voice_duration!=null)add("Voice duration",formatDuration(msg.voice_duration));
  if(group)add("Items in this message",group.items.length);
  if(msg.reply_to_id){const parent=STATE.messageById.get(msg.reply_to_id);add("Reply",parent?`${parent.sender_key===STATE.currentUser.key?STATE.currentUser.name:STATE.counterpartUser.name}: ${getMessageReplyPreview(parent)}`:"Original message unavailable");}
  const reactions=msg.message_reactions||[];add("Reactions",reactions.length?reactions.map(r=>`${r.emoji} ${r.identity_key===STATE.currentUser.key?STATE.currentUser.name:STATE.counterpartUser.name}`).join(" · "):"None");
  add("Message reference",String(msg.id).slice(-12));
  $("messageInfoModal").classList.remove("hidden");
}

async function loadMessageActionWindowSetting(){try{const {data,error}=await STATE.supabase.rpc("get_message_action_window_minutes");if(error)throw error;const minutes=Math.max(1,Math.min(1440,Number(data)||CONFIG.MESSAGE_EDIT_DELETE_WINDOW_MINUTES));CONFIG.MESSAGE_EDIT_DELETE_WINDOW_MINUTES=minutes;CONFIG.MESSAGE_EDIT_DELETE_WINDOW_MS=minutes*60*1000;}catch(e){console.warn("Using local message action window setting",e);CONFIG.MESSAGE_EDIT_DELETE_WINDOW_MS=CONFIG.MESSAGE_EDIT_DELETE_WINDOW_MINUTES*60*1000;}}
function messageActionWindowLabel(){return `${CONFIG.MESSAGE_EDIT_DELETE_WINDOW_MINUTES} minutes`;}
async function toggleSelectedMessagePin(){const msg=STATE.messageById.get(STATE.selectedMessageId);if(!msg)return;try{const {data,error}=await STATE.supabase.rpc("set_message_pinned",{p_message_id:msg.id,p_identity_key:STATE.currentUser.key,p_is_pinned:!msg.is_pinned});if(error)throw error;if(data){const updated=Array.isArray(data)?data[0]:data;Object.assign(msg,updated||{is_pinned:!msg.is_pinned});STATE.messageById.set(msg.id,msg);renderSingleMessage(msg.id);$("btnPinSelected").textContent=msg.is_pinned?"📌✓":"📌";$("btnPinSelected").title=msg.is_pinned?"Unpin message":"Pin message";showToast(msg.is_pinned?"Message pinned":"Message unpinned");}else await loadMessages();}catch(e){console.error(e);showToast(e.message||"Unable to update pin.");}}
function openPinnedGallery(){const list=$("pinnedGalleryList");list.innerHTML="";const pinned=STATE.messages.filter(m=>m.is_pinned&&!m.is_deleted_everyone&&!(m.scheduled_for&&!m.delivered_at)&&m.message_kind!=="gif").sort((a,b)=>new Date(b.pinned_at||b.created_at)-new Date(a.pinned_at||a.created_at));if(!pinned.length){list.innerHTML='<p class="empty-state">No pinned messages yet</p>';}else{for(const msg of pinned){const item=document.createElement("button");item.type="button";item.className="pinned-gallery-item";const kind=document.createElement("span");kind.className="pinned-gallery-kind";kind.textContent=({text:"TEXT",link:"LINK",image:"MEDIA",video:"VIDEO",voice:"VOICE",file:"FILE"}[msg.message_type]||"MESSAGE");const preview=document.createElement("span");preview.className="pinned-gallery-preview";preview.textContent=getMessageReplyPreview(msg);const meta=document.createElement("small");meta.textContent=`${msg.sender_key===STATE.currentUser.key?STATE.currentUser.name:STATE.counterpartUser.name} · ${new Date(msg.created_at).toLocaleString("en-GB")}`;item.append(kind,preview,meta);item.onclick=()=>{closeModal("pinnedGalleryOverlay");jumpToOriginalMessage(msg.id);};list.appendChild(item);}}$("pinnedGalleryOverlay").classList.remove("hidden");}

function jumpToOriginalMessage(messageId){const target=document.querySelector(`.message-row[data-id="${CSS.escape(String(messageId))}"]`);if(!target)return showToast("Original message is not available in this chat.");const scroller=$("chatMessages");if(scroller){const targetRect=target.getBoundingClientRect(),scrollerRect=scroller.getBoundingClientRect();const centeredDelta=targetRect.top-scrollerRect.top-(scroller.clientHeight-targetRect.height)/2;scroller.scrollTo({top:scroller.scrollTop+centeredDelta,behavior:"smooth"});}else target.scrollIntoView({behavior:"smooth",block:"center"});document.querySelectorAll(".reply-jump-highlight").forEach(el=>el.classList.remove("reply-jump-highlight"));void target.offsetWidth;target.classList.add("reply-jump-highlight");clearTimeout(STATE.replyJumpTimerId);STATE.replyJumpTimerId=setTimeout(()=>{target.classList.remove("reply-jump-highlight");STATE.replyJumpTimerId=null;},2000);}

function createInlineVoicePlayer(msg){
  const wrap=document.createElement("div");wrap.className="voice-player";
  const row=document.createElement("div");row.className="voice-controls-row";
  const play=document.createElement("button");play.type="button";play.className="btn-voice-play";play.textContent="▶";play.setAttribute("aria-label","Play voice message");
  const wave=document.createElement("div");wave.className="voice-waveform";wave.setAttribute("role","slider");wave.setAttribute("aria-label","Voice playback position");wave.setAttribute("tabindex","0");
  const values=Array.isArray(msg.voice_waveform)&&msg.voice_waveform.length?msg.voice_waveform:null,count=48,seed=hashString(msg.id);
  for(let i=0;i<count;i++){const bar=document.createElement("span");bar.className="wave-bar";const value=values?Number(values[Math.min(values.length-1,Math.floor(i/count*values.length))]):(0.18+((seed+i*17)%79)/100);bar.style.height=`${Math.max(5,Math.min(30,6+value*25))}px`;wave.appendChild(bar);}
  const speed=document.createElement("button");speed.type="button";speed.className="voice-speed";speed.textContent="1×";speed.setAttribute("aria-label","Change playback speed");row.append(play,wave,speed);
  const meta=document.createElement("div");meta.className="voice-meta-row";const time=document.createElement("span");time.className="voice-time-label";time.textContent=`0:00 / ${formatDuration(msg.voice_duration||0)}`;const dl=document.createElement("button");dl.type="button";dl.className="voice-download-btn";dl.textContent="↓ MP3";dl.onclick=e=>{e.stopPropagation();downloadVoiceAsMp3(msg);};meta.append(time,dl);wrap.append(row,meta);
  let audio=null,rateIndex=0;const rates=[1,1.25,1.5,2];
  const paint=()=>{const duration=audio?.duration&&Number.isFinite(audio.duration)?audio.duration:Number(msg.voice_duration)||0,current=audio?.currentTime||0;time.textContent=`${formatDuration(current)} / ${formatDuration(duration)}`;const ratio=duration?current/duration:0;const played=Math.floor(ratio*wave.children.length);for(let i=0;i<wave.children.length;i++)wave.children[i].classList.toggle("played",i<played);play.textContent=audio&&!audio.paused?"Ⅱ":"▶";play.setAttribute("aria-label",audio&&!audio.paused?"Pause voice message":"Play voice message");};
  const ensure=async()=>{if(audio)return audio;const url=await loadAuthorizedMediaUrl(msg.storage_path,CONFIG.STORAGE.VOICE_BUCKET,true);if(!url)throw new Error("Voice unavailable");audio=new Audio();audio.preload="metadata";audio.src=url;audio.addEventListener("loadedmetadata",paint);audio.addEventListener("durationchange",paint);audio.addEventListener("timeupdate",paint);audio.addEventListener("play",paint);audio.addEventListener("pause",paint);audio.addEventListener("ended",()=>{paint();if(STATE.activeAudioPlayer===audio){STATE.activeAudioPlayer=null;STATE.activeAudioUI=null;}});audio.addEventListener("error",()=>{showToast("This voice message could not be decoded by this browser.");play.textContent="▶";});return audio;};
  play.onclick=async e=>{e.stopPropagation();try{const a=await ensure();if(a.paused){if(STATE.activeAudioPlayer&&STATE.activeAudioPlayer!==a){STATE.activeAudioPlayer.pause();STATE.activeAudioUI?.();}await a.play();STATE.activeAudioPlayer=a;STATE.activeAudioUI=paint;}else{a.pause();}paint();}catch(err){console.error("voice playback",err);showToast("Unable to play voice clip. Try downloading the original audio.");}};
  speed.onclick=e=>{e.stopPropagation();rateIndex=(rateIndex+1)%rates.length;speed.textContent=`${rates[rateIndex]}×`;if(audio)audio.playbackRate=rates[rateIndex];};
  const seekFromEvent=e=>{const rect=wave.getBoundingClientRect(),x=e.clientX??(e.touches?.[0]?.clientX);if(!Number.isFinite(x)||!rect.width)return;const ratio=Math.max(0,Math.min(1,(x-rect.left)/rect.width));ensure().then(a=>{const duration=a.duration||Number(msg.voice_duration)||0;if(duration>0)a.currentTime=duration*ratio;paint();}).catch(()=>showToast("Voice timeline is unavailable."));};
  wave.addEventListener("click",e=>{e.stopPropagation();seekFromEvent(e);});wave.addEventListener("keydown",e=>{if(e.key==="ArrowRight"||e.key==="ArrowLeft"){e.preventDefault();ensure().then(a=>{a.currentTime=Math.max(0,Math.min(a.duration||msg.voice_duration||0,a.currentTime+(e.key==="ArrowRight"?5:-5)));paint();}).catch(()=>{});}});
  return wrap;
}
async function buildVoiceWaveform(blob,bars=48){let context=null;try{const AudioContextClass=window.AudioContext||window.webkitAudioContext;if(!AudioContextClass)return null;context=new AudioContextClass();const buffer=await context.decodeAudioData(await blob.arrayBuffer());const channel=buffer.getChannelData(0),out=[];const chunk=Math.max(1,Math.floor(channel.length/bars));for(let i=0;i<bars;i++){let peak=0;for(let j=i*chunk;j<Math.min(channel.length,(i+1)*chunk);j+=3)peak=Math.max(peak,Math.abs(channel[j]));out.push(Math.max(.08,Math.min(1,peak)));}return out;}catch(e){console.warn("Could not build voice waveform",e);return null;}finally{try{await context?.close();}catch{}}}
function hashString(str){let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}return Math.abs(h);}
function formatDuration(seconds){const s=Math.max(0,Math.floor(Number(seconds)||0));return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;}

function updateActivityIndicators(){
  const typing=$("counterpartTypingIndicator"),recording=$("counterpartRecordingIndicator");
  if(typing)typing.classList.toggle("hidden",!STATE.counterpartTyping);
  if(recording)recording.classList.toggle("hidden",!STATE.counterpartRecording);
  const status=$("counterpartStatus");
  if(status&&!STATE.counterpartRecording&&!STATE.counterpartTyping)loadCounterpartPresence();
}
function broadcastActivity(event,payload={}){
  try{STATE.realtimeChannel?.send({type:"broadcast",event,payload:{...payload,identity_key:STATE.currentUser?.key||null}});}catch(e){console.warn("activity broadcast",e);}
}
function broadcastTypingState(active){
  if(!STATE.currentUser||!STATE.realtimeChannel)return;
  if(active){
    if(!STATE.isTyping){STATE.isTyping=true;broadcastActivity("typing",{active:true});}
    clearTimeout(STATE.typingStopTimeoutId);
    STATE.typingStopTimeoutId=setTimeout(()=>broadcastTypingState(false),1800);
  }else{
    clearTimeout(STATE.typingStopTimeoutId);
    STATE.typingStopTimeoutId=null;
    if(STATE.isTyping){STATE.isTyping=false;broadcastActivity("typing",{active:false});}
  }
}
function broadcastRecordingState(active){
  if(!STATE.currentUser||!STATE.realtimeChannel)return;
  broadcastActivity("recording",{active:!!active});
}
function handleRealtimeActivity(payload){
  const p=payload?.payload||{};
  if(!p.identity_key||p.identity_key===STATE.currentUser?.key||p.identity_key!==STATE.counterpartUser?.key)return;
  if(payload.event==="typing"){STATE.counterpartTyping=!!p.active;if(STATE.counterpartTyping)STATE.counterpartRecording=false;}
  if(payload.event==="recording"){STATE.counterpartRecording=!!p.active;if(STATE.counterpartRecording)STATE.counterpartTyping=false;}
  updateActivityIndicators();
}

async function startVoiceRecording(){if(STATE.mediaRecorder)return;try{if(!navigator.mediaDevices?.getUserMedia)throw new Error();const stream=await navigator.mediaDevices.getUserMedia({audio:true});const preferred=["audio/webm;codecs=opus","audio/webm","audio/mp4"].find(t=>MediaRecorder.isTypeSupported?.(t))||"audio/webm";STATE.audioChunks=[];STATE.mediaRecorder=new MediaRecorder(stream,{mimeType:preferred});STATE.recordingStartTime=Date.now();STATE.recordingPausedAt=0;STATE.recordingPausedTotal=0;STATE.mediaRecorder.ondataavailable=e=>{if(e.data.size)STATE.audioChunks.push(e.data);};STATE.mediaRecorder.onstop=()=>stream.getTracks().forEach(t=>t.stop());STATE.mediaRecorder.start(250);broadcastRecordingState(true);$("normalComposer").classList.add("hidden");$("recordingComposer").classList.remove("hidden");updateRecordingTimer();STATE.recordingTimerId=setInterval(updateRecordingTimer,500);}catch(e){console.error(e);showToast("Microphone access denied or unavailable.");}}
function updateRecordingTimer(){if(!STATE.mediaRecorder)return;let now=Date.now(),paused=STATE.recordingPausedAt?now-STATE.recordingPausedAt:0;const sec=Math.max(0,Math.floor((now-STATE.recordingStartTime-STATE.recordingPausedTotal-paused)/1000));$("recordingTimer").textContent=formatDuration(sec);}
function togglePauseRecording(){const r=STATE.mediaRecorder;if(!r)return;if(r.state==="recording"){r.pause();STATE.recordingPausedAt=Date.now();$("btnPauseResumeRecord").textContent="▶";}else if(r.state==="paused"){STATE.recordingPausedTotal+=Date.now()-STATE.recordingPausedAt;STATE.recordingPausedAt=0;r.resume();$("btnPauseResumeRecord").textContent="Ⅱ";}updateRecordingTimer();}
function cleanupRecorder(){broadcastRecordingState(false);clearInterval(STATE.recordingTimerId);STATE.recordingTimerId=null;STATE.mediaRecorder?.stream?.getTracks().forEach(t=>t.stop());STATE.mediaRecorder=null;STATE.audioChunks=[];$("recordingComposer").classList.add("hidden");$("normalComposer").classList.remove("hidden");$("btnPauseResumeRecord").textContent="Ⅱ";$("recordingTimer").textContent="0:00";}
function stopAndDiscardRecording(){const r=STATE.mediaRecorder;if(!r)return;if(r.state!=="inactive")r.stop();cleanupRecorder();}
async function stopAndSendRecording(){
  const r=STATE.mediaRecorder;
  if(!r||r.state==="inactive")return;
  const replyToId=STATE.replyTargetMessage?.id||null;
  const startMime=r.mimeType||"audio/webm";
  const duration=Math.max(0,Math.floor((Date.now()-STATE.recordingStartTime-STATE.recordingPausedTotal-(STATE.recordingPausedAt?Date.now()-STATE.recordingPausedAt:0))/1000));
  const chunks=STATE.audioChunks,stream=r.stream;
  const afterStop=new Promise(resolve=>r.addEventListener("stop",resolve,{once:true}));
  r.stop();broadcastRecordingState(false);clearInterval(STATE.recordingTimerId);STATE.recordingTimerId=null;
  await afterStop;stream.getTracks().forEach(t=>t.stop());
  const blob=new Blob(chunks,{type:startMime});STATE.mediaRecorder=null;STATE.audioChunks=[];
  $("recordingComposer").classList.add("hidden");$("normalComposer").classList.remove("hidden");
  try{
    const ext=startMime.includes("mp4")?"m4a":"webm",name=`voice_${Date.now()}.${ext}`,path=`${STATE.roomId}/${name}`;const waveform=await buildVoiceWaveform(blob);startUploadStatus(blob.size,"Uploading voice message");
    await uploadStorageFileWithProgress(CONFIG.STORAGE.VOICE_BUCKET,path,new File([blob],name,{type:startMime}),(loaded)=>updateUploadForFile(loaded,"Uploading voice message"));const elapsed=finishUploadStatus(true);
    await insertChatMessage({message_type:"voice",storage_path:path,mime_type:startMime,file_name:name,voice_duration:duration,voice_waveform:waveform,upload_duration_seconds:elapsed},replyToId);
    cancelReplyState();showToast(`Voice sent · ${formatDuration(duration)}`);
  }catch(e){console.error("voice send",e);finishUploadStatus(false);showToast(getSendErrorMessage(e,"Voice send"));}
}

function handleFileSelected(e){closeModal("fileChooserOverlay");prepareMediaFiles(Array.from(e.target.files||[]));e.target.value="";}
function handleGifFileSelected(e){closeModal("fileChooserOverlay");const file=e.target.files?.[0];e.target.value="";if(!file)return;if(file.type!=="image/gif"&&!/\.gif$/i.test(file.name)){showToast("Choose a GIF image.");return;}prepareMediaFiles([file]);}
function prepareMediaFiles(files){
  if(!files.length)return;
  const invalid=files.find(f=>!f.type.startsWith("image/")&&!f.type.startsWith("video/"));
  if(invalid){showToast("Choose photos/videos here; use Documents for other files.");return;}
  const oversized=files.find(f=>f.size>80*1024*1024);
  if(oversized){showToast(`${oversized.name} is larger than 80 MB.`);return;}
  cleanupPreviewUrl();STATE.pendingUploadFiles=files;STATE.pendingUploadFile=files[0]||null;STATE.pendingImageRotation=0;
  STATE.pendingPreviewUrls=files.map(f=>URL.createObjectURL(f));STATE.pendingPreviewUrl=STATE.pendingPreviewUrls[0]||null;
  const stage=$("previewMediaWrapper"),img=$("imagePreviewElement"),vid=$("videoPreviewElement"),editor=$("imageEditorBar");
  let grid=document.getElementById("multiMediaPreviewGrid");if(!grid){grid=document.createElement("div");grid.id="multiMediaPreviewGrid";grid.className="multi-media-preview-grid";stage.appendChild(grid);}
  grid.innerHTML="";const multi=files.length>1;grid.classList.toggle("hidden",!multi);img.classList.toggle("hidden",multi);vid.classList.toggle("hidden",multi);editor.classList.toggle("hidden",multi||files[0].type.startsWith("video/"));
  if(multi){files.forEach((file,i)=>{const tile=document.createElement("div");tile.className="multi-media-preview-tile";const el=file.type.startsWith("video/")?document.createElement("video"):document.createElement("img");el.src=STATE.pendingPreviewUrls[i];el.className="multi-media-preview-item";if(el.tagName==="VIDEO"){el.muted=true;el.controls=false;el.playsInline=true;el.preload="metadata";}else el.alt=file.name;tile.appendChild(el);const label=document.createElement("span");label.textContent=file.type.startsWith("video/")?"VIDEO":"PHOTO";tile.appendChild(label);grid.appendChild(tile);});}
  else if(files[0].type.startsWith("video/")){vid.src=STATE.pendingPreviewUrl;img.removeAttribute("src");}
  else{img.src=STATE.pendingPreviewUrl;img.style.transform="rotate(0deg)";vid.pause();vid.removeAttribute("src");}
  const title=$("mediaPreviewOverlay").querySelector(".modal-title");if(title)title.textContent=multi?`Send ${files.length} items`:"Send Media";
  const send=$("btnConfirmSendMedia");if(send)send.innerHTML=`<span>Send ${files.length>1?files.length+" items":"Media"}</span><span>➤</span>`;
  $("mediaPreviewOverlay").classList.remove("hidden");
}
function rotatePreviewImage(){if(STATE.pendingUploadFiles.length>1)return;STATE.pendingImageRotation=(STATE.pendingImageRotation+90)%360;$("imagePreviewElement").style.transform=`rotate(${STATE.pendingImageRotation}deg)`;}
function cleanupPreviewUrl(){for(const url of STATE.pendingPreviewUrls||[])if(url)URL.revokeObjectURL(url);if(STATE.pendingPreviewUrl&&!STATE.pendingPreviewUrls?.length)URL.revokeObjectURL(STATE.pendingPreviewUrl);STATE.pendingPreviewUrls=[];STATE.pendingPreviewUrl=null;}
function cancelMediaPreview(){cleanupPreviewUrl();STATE.pendingUploadFile=null;STATE.pendingUploadFiles=[];$("mediaFileInput").value="";$("videoPreviewElement").pause();$("videoPreviewElement").removeAttribute("src");$("imagePreviewElement").removeAttribute("src");const grid=$("multiMediaPreviewGrid");if(grid){grid.innerHTML="";grid.classList.add("hidden");}const title=$("mediaPreviewOverlay").querySelector(".modal-title");if(title)title.textContent="Send Media";const send=$("btnConfirmSendMedia");if(send)send.innerHTML="<span>Send Media</span><span>➤</span>";closeModal("mediaPreviewOverlay");}
function handleDocumentFileSelected(e){closeModal("fileChooserOverlay");const file=e.target.files?.[0];e.target.value="";if(!file)return;if(file.type.startsWith("image/")||file.type.startsWith("video/")){showToast("Use the photo/video option for images and videos.");return;}if(file.size>80*1024*1024){showToast("Please choose a file smaller than 80 MB.");return;}STATE.pendingDocumentFile=file;const ext=getFileExtension(file.name);const icon=$("filePreviewIcon");icon.className=`file-type-icon file-preview-type-icon ${getFileIconClass(ext)}`;icon.textContent=(ext||"FILE").slice(0,5).toUpperCase();$("filePreviewName").textContent=file.name;$("filePreviewDetails").textContent=[formatBytes(file.size),file.type||"Unknown file type"].filter(Boolean).join(" • ");$("fileUploadPreviewOverlay").classList.remove("hidden");}
function cancelFilePreview(){STATE.pendingDocumentFile=null;$("documentFileInput").value="";closeModal("fileUploadPreviewOverlay");}
function setupArtEditor(){
  const canvas=$("artCanvas"),ctx=canvas.getContext("2d",{willReadFrequently:true});if(!canvas||!ctx)return;canvas.style.backgroundColor=$("artBackground").value;ctx.clearRect(0,0,canvas.width,canvas.height);
  const point=e=>{const rect=canvas.getBoundingClientRect();return{x:(e.clientX-rect.left)/rect.width*canvas.width,y:(e.clientY-rect.top)/rect.height*canvas.height};};
  const saveUndo=()=>{try{STATE.artHistory.push(ctx.getImageData(0,0,canvas.width,canvas.height));if(STATE.artHistory.length>8)STATE.artHistory.shift();}catch{}};
  canvas.addEventListener("pointerdown",e=>{e.preventDefault();canvas.setPointerCapture?.(e.pointerId);saveUndo();STATE.artDrawing=true;STATE.artLastPoint=point(e);drawArtSegment(ctx,STATE.artLastPoint,STATE.artLastPoint);});
  canvas.addEventListener("pointermove",e=>{if(!STATE.artDrawing)return;e.preventDefault();const next=point(e);drawArtSegment(ctx,STATE.artLastPoint,next);STATE.artLastPoint=next;});
  const end=()=>{STATE.artDrawing=false;STATE.artLastPoint=null;ctx.globalCompositeOperation="source-over";ctx.shadowBlur=0;};canvas.addEventListener("pointerup",end);canvas.addEventListener("pointercancel",end);canvas.addEventListener("lostpointercapture",end);
  document.querySelectorAll(".art-tool").forEach(btn=>btn.addEventListener("click",()=>{STATE.artTool=btn.dataset.tool;document.querySelectorAll(".art-tool").forEach(x=>x.classList.toggle("active",x===btn));}));
  $("artSize").addEventListener("input",()=>$("artSizeValue").textContent=`${$("artSize").value} px`);
  $("artBackground").addEventListener("input",()=>canvas.style.backgroundColor=$("artBackground").value);
  $("artPalette").addEventListener("click",e=>{const btn=e.target.closest("[data-color]");if(btn){$("artColor").value=btn.dataset.color;}});
}
function drawArtSegment(ctx,from,to){const tool=STATE.artTool,color=$("artColor").value,size=Number($("artSize").value)||6;ctx.save();ctx.lineCap="round";ctx.lineJoin="round";ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);
  if(tool==="eraser"){ctx.globalCompositeOperation="destination-out";ctx.globalAlpha=1;ctx.lineWidth=size*3;}
  else{ctx.globalCompositeOperation="source-over";ctx.strokeStyle=color;ctx.globalAlpha=tool==="highlighter"?.22:tool==="marker"?.68:1;ctx.lineWidth=tool==="highlighter"?size*3:tool==="marker"?size*2:size;if(tool==="glow"){ctx.shadowColor=color;ctx.shadowBlur=size*3;ctx.lineWidth=size*1.5;}}
  ctx.stroke();ctx.restore();}
function openArtEditor(){STATE.artHistory=[];STATE.artTool="pen";$("artColor").value="#ffffff";$("artBackground").value="#0b1930";$("artSize").value="6";$("artSizeValue").textContent="6 px";document.querySelectorAll(".art-tool").forEach(x=>x.classList.toggle("active",x.dataset.tool==="pen"));const canvas=$("artCanvas"),ctx=canvas.getContext("2d");ctx.clearRect(0,0,canvas.width,canvas.height);canvas.style.backgroundColor=$("artBackground").value;$("artEditorOverlay").classList.remove("hidden");}
function clearArtCanvas(){const canvas=$("artCanvas"),ctx=canvas.getContext("2d");try{STATE.artHistory.push(ctx.getImageData(0,0,canvas.width,canvas.height));if(STATE.artHistory.length>8)STATE.artHistory.shift();}catch{}ctx.clearRect(0,0,canvas.width,canvas.height);}
function undoArtCanvas(){const data=STATE.artHistory.pop();if(data)$("artCanvas").getContext("2d").putImageData(data,0,0);}
async function prepareArtForSending(){const canvas=$("artCanvas"),out=document.createElement("canvas");out.width=canvas.width;out.height=canvas.height;const ctx=out.getContext("2d");ctx.fillStyle=$("artBackground").value;ctx.fillRect(0,0,out.width,out.height);ctx.drawImage(canvas,0,0);out.toBlob(blob=>{if(!blob){showToast("Could not create the artwork image.");return;}const file=new File([blob],`art_${Date.now()}.png`,{type:"image/png"});closeModal("artEditorOverlay");prepareMediaFiles([file]);},"image/png");}

function formatUploadClock(seconds){const n=Math.max(0,Math.floor(Number(seconds)||0));return `${Math.floor(n/60)}:${String(n%60).padStart(2,"0")}`;}
function startUploadStatus(totalBytes,label){STATE.uploadStartedAt=Date.now();STATE.uploadTotalBytes=Math.max(1,Number(totalBytes)||1);STATE.uploadCompletedBytes=0;STATE.uploadLastProgressAt=Date.now();STATE.uploadLastLoaded=0;STATE.uploadDurationSeconds=0;$("uploadStatusPanel").classList.remove("hidden");$("uploadStatusTitle").textContent=label||"Uploading…";$("uploadStatusPercent").textContent="0%";$("uploadProgressFill").style.width="0%";$("uploadStatusElapsed").textContent="Elapsed 0:00";$("uploadStatusRemaining").textContent="Estimating time…";clearInterval(STATE.uploadTimerId);STATE.uploadTimerId=setInterval(()=>refreshUploadClock(),400);}
function refreshUploadClock(){if(!STATE.uploadStartedAt)return;const elapsed=(Date.now()-STATE.uploadStartedAt)/1000;$("uploadStatusElapsed").textContent=`Elapsed ${formatUploadClock(elapsed)}`;}
function updateUploadStatus(loaded,total,label){const done=STATE.uploadCompletedBytes+Math.max(0,loaded||0),percent=Math.min(100,Math.round(done/STATE.uploadTotalBytes*100));$("uploadStatusPercent").textContent=`${percent}%`;$("uploadProgressFill").style.width=`${percent}%`;if(label)$("uploadStatusTitle").textContent=label;const now=Date.now(),delta=done-STATE.uploadLastLoaded,seconds=(now-STATE.uploadLastProgressAt)/1000;if(delta>0&&seconds>=.25){const speed=delta/seconds,remaining=(STATE.uploadTotalBytes-done)/Math.max(1,speed);$("uploadStatusRemaining").textContent=remaining>0?`About ${formatUploadClock(remaining)} left`:`Finishing…`;STATE.uploadLastLoaded=done;STATE.uploadLastProgressAt=now;}refreshUploadClock();}
function finishUploadStatus(success=true){if(!STATE.uploadStartedAt)return 0;const duration=Math.max(1,Math.ceil((Date.now()-STATE.uploadStartedAt)/1000));clearInterval(STATE.uploadTimerId);STATE.uploadTimerId=null;STATE.uploadDurationSeconds=duration;if(success){$("uploadStatusTitle").textContent="Upload complete";$("uploadStatusPercent").textContent="100%";$("uploadProgressFill").style.width="100%";$("uploadStatusRemaining").textContent=`Finished in ${formatUploadClock(duration)}`;$("uploadStatusElapsed").textContent=`Total ${formatUploadClock(duration)}`;}else{$("uploadStatusTitle").textContent="Upload stopped";$("uploadStatusRemaining").textContent="Try again when ready";}STATE.uploadStartedAt=0;setTimeout(()=>$("uploadStatusPanel").classList.add("hidden"),success?4500:1800);return duration;}
async function uploadStorageFileWithProgress(bucket,path,file,onProgress){
  const {data:{session}}=await STATE.supabase.auth.getSession();if(!session?.access_token)throw new Error("Your secure session expired. Sign in again.");
  const encodedPath=String(path).split("/").map(encodeURIComponent).join("/");const endpoint=`${CONFIG.SUPABASE_URL}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`;
  return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open("POST",endpoint,true);xhr.setRequestHeader("Authorization",`Bearer ${session.access_token}`);xhr.setRequestHeader("apikey",CONFIG.SUPABASE_PUBLISHABLE_KEY);xhr.setRequestHeader("Content-Type",file.type||"application/octet-stream");xhr.setRequestHeader("x-upsert","false");xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress?.(e.loaded,e.total);};xhr.onerror=()=>reject(new Error("Network error while uploading."));xhr.onabort=()=>reject(new Error("Upload cancelled."));xhr.onload=()=>{let payload={};try{payload=JSON.parse(xhr.responseText||"{}");}catch{}if(xhr.status>=200&&xhr.status<300)resolve(payload);else reject(new Error(payload.message||payload.error||`Upload failed (${xhr.status}).`));};xhr.send(file);});
}
function updateUploadForFile(fileLoaded,label){updateUploadStatus(fileLoaded,STATE.uploadTotalBytes,label);}

async function uploadAndSendDocument(){
  const file=STATE.pendingDocumentFile;if(!file||STATE.isUploadingDocument)return;if(!STATE.currentUser||!STATE.roomId){showToast("Please sign in again before sending files.");return;}
  STATE.isUploadingDocument=true;const replyToId=STATE.replyTargetMessage?.id||null;const btn=$("btnConfirmSendFile");setLoading(btn,true,"Uploading…");const safeName=String(file.name||"download").replace(/[\\/:*?"<>|]/g,"_").replace(/[\u0000-\u001f]/g,"_").slice(0,180)||"download";const path=`${STATE.roomId}/file_${Date.now()}_${safeName}`;startUploadStatus(file.size,`Uploading ${safeName}`);
  try{await uploadStorageFileWithProgress(CONFIG.STORAGE.MEDIA_BUCKET,path,file,(loaded)=>updateUploadForFile(loaded,`Uploading ${safeName}`));const elapsed=finishUploadStatus(true);await insertChatMessage({message_type:"file",storage_path:path,mime_type:file.type||"application/octet-stream",file_name:file.name||safeName,file_size:file.size,upload_duration_seconds:elapsed},replyToId);cancelFilePreview();cancelReplyState();showToast(`File sent · uploaded in ${formatUploadClock(elapsed)}`);}
  catch(e){console.error("file upload/send",e);finishUploadStatus(false);showToast(getSendErrorMessage(e,"File send"));}
  finally{STATE.isUploadingDocument=false;setLoading(btn,false);}
}
async function uploadAndSendMedia(){
  const files=STATE.pendingUploadFiles.length?STATE.pendingUploadFiles:(STATE.pendingUploadFile?[STATE.pendingUploadFile]:[]);if(!files.length||STATE.isUploading)return;if(!STATE.currentUser||!STATE.roomId){showToast("Please sign in again before sending media.");return;}
  STATE.isUploading=true;const replyToId=STATE.replyTargetMessage?.id||null;const btn=$("btnConfirmSendMedia");setLoading(btn,true,"Uploading…");const uploaded=[],totalBytes=files.reduce((sum,file)=>sum+file.size,0);startUploadStatus(totalBytes,`Uploading ${files.length} item${files.length===1?"":"s"}`);
  try{
    for(let i=0;i<files.length;i++){const file=files[i],safeName=String(file.name||`media-${Date.now()}`).replace(/[\\/:*?"<>|]/g,"_").slice(0,180),path=`${STATE.roomId}/${Date.now()}_${i}_${safeName}`;await uploadStorageFileWithProgress(CONFIG.STORAGE.MEDIA_BUCKET,path,file,(loaded)=>updateUploadForFile(loaded,`Uploading ${i+1}/${files.length}`));uploaded.push({storage_path:path,file_name:file.name||safeName,mime_type:file.type||"image/png",message_type:file.type.startsWith("video/")?"video":"image",file_size:file.size});STATE.uploadCompletedBytes+=file.size;STATE.uploadLastLoaded=STATE.uploadCompletedBytes;updateUploadStatus(0,totalBytes,`Uploaded ${i+1}/${files.length}`);}
    const elapsed=finishUploadStatus(true);
    if(uploaded.length===1){const item=uploaded[0];await insertChatMessage({message_type:item.message_type,storage_path:item.storage_path,mime_type:item.mime_type,file_name:item.file_name,upload_duration_seconds:elapsed},replyToId);}
    else{const group={__rs_media_group_v1:true,items:uploaded};await insertChatMessage({message_type:"image",storage_path:uploaded[0].storage_path,mime_type:"application/x-rs-media-group",file_name:`${uploaded.length} media items`,content:JSON.stringify(group),upload_duration_seconds:elapsed},replyToId);}
    cancelMediaPreview();cancelReplyState();showToast(`${files.length>1?`${files.length} media items`:"Media"} sent · uploaded in ${formatUploadClock(elapsed)}`);
  }catch(e){console.error("media upload/send",e);finishUploadStatus(false);showToast(getSendErrorMessage(e,"Media send"));}
  finally{STATE.isUploading=false;setLoading(btn,false);}
}
function getMediaGroup(msg){if(!msg?.content)return null;try{const value=JSON.parse(msg.content);return value?.__rs_media_group_v1&&Array.isArray(value.items)?value:null;}catch{return null;}}
async function insertChatMessage(fields,replyToId=STATE.replyTargetMessage?.id||null){
  if(!STATE.supabase||!STATE.currentUser||!STATE.roomId)throw new Error("Your chat session is not ready. Sign in again.");
  const row={...fields,room_id:STATE.roomId,sender_key:STATE.currentUser.key,reply_to_id:replyToId||null};
  const {data,error}=await STATE.supabase.from("messages").insert(row).select("*").single();
  if(error)throw error;
  // Render immediately so the sender is not dependent on a Realtime packet arriving.
  // The ID check prevents duplicate bubbles if Realtime wins the race.
  if(data&&!STATE.messageById.has(data.id)){
    const message={...data,message_reactions:[],message_visibility:[]};
    STATE.messages.push(message);STATE.messages.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
    STATE.messageById.set(message.id,message);renderMessagesList(true);
  }
  return data;
}
function getSendErrorMessage(error,operation="Message send"){
  const raw=String(error?.message||error||"");
  if(/row.level security|permission denied|not allowed/i.test(raw))return `${operation} was blocked by Supabase permissions. Run extra/FULL_SUPABASE_SETUP.sql on ${CONFIG.SUPABASE_URL} and confirm Anonymous Sign-Ins is enabled.`;
  if(/foreign key|reply_to_id|valid_chat_reply_target/i.test(raw))return "The original message may no longer be available. Cancel the reply and try again.";
  return raw?`${operation} failed: ${raw.slice(0,170)}`:`${operation} failed. Check your connection and Supabase settings.`;
}
async function handleSendMessage(){
  if(STATE.isSendingMessage)return;
  const ta=$("messageTextArea"),text=ta.value.trim();
  if(!text)return;
  if(!STATE.currentUser||!STATE.roomId){showToast("Please sign in again before sending.");return;}
  STATE.isSendingMessage=true;
  const btn=$("btnSendMessage"),wasDisabled=btn.disabled;btn.disabled=true;btn.setAttribute("aria-busy","true");
  const replyToId=STATE.replyTargetMessage?.id||null;
  broadcastTypingState(false);
  try{
    if(STATE.editingMessageId){
      const msg=STATE.messageById.get(STATE.editingMessageId);
      if(!msg||msg.sender_key!==STATE.currentUser.key||!isWithinMessageActionWindow(msg)){showToast("This message can no longer be edited.");cancelEditState();return;}
      const {error}=await STATE.supabase.rpc("edit_message",{p_message_id:msg.id,p_sender_key:STATE.currentUser.key,p_new_content:text});
      if(error)throw error;
      cancelEditState();
    }else{
      await insertChatMessage({message_type:"text",content:text},replyToId);
      if(replyToId)cancelReplyState();
    }
    ta.value="";ta.style.height="auto";onComposerInput();
  }catch(e){console.error("message send",e);showToast(getSendErrorMessage(e,"Message send"));}
  finally{STATE.isSendingMessage=false;btn.disabled=wasDisabled;btn.removeAttribute("aria-busy");}
}
function initiateReply(message=null){const msg=message&&message.id?message:STATE.messageById.get(STATE.selectedMessageId);if(!msg){showToast("Select a message to reply to.");return;}if(STATE.editingMessageId)cancelEditState();STATE.replyTargetMessage=msg;$("replyTargetAuthor").textContent=`Replying to ${msg.sender_key===STATE.currentUser.key?STATE.currentUser.name:STATE.counterpartUser.name}`;setExpandablePreview($("replyTargetText"),getMessageReplyPreview(msg),30);$("replyPreviewBanner").classList.remove("hidden");clearMessageSelection();$("messageTextArea").focus();}
function cancelReplyState(){STATE.replyTargetMessage=null;$("replyPreviewBanner").classList.add("hidden");$("replyTargetText").innerHTML="";}
function initiateEdit(){const msg=STATE.messageById.get(STATE.selectedMessageId);if(!msg||msg.sender_key!==STATE.currentUser.key||msg.message_type!=="text"||!isWithinMessageActionWindow(msg)){showToast(`Edit is available for your text messages within ${messageActionWindowLabel()}. Change MESSAGE_EDIT_DELETE_WINDOW_MINUTES in CONFIG.`);return;}cancelReplyState();STATE.editingMessageId=msg.id;$("messageTextArea").value=msg.content||"";$("editTargetText").textContent=msg.content||"";$("editPreviewBanner").classList.remove("hidden");clearMessageSelection();onComposerInput();$("messageTextArea").focus();}
function cancelEditState(){STATE.editingMessageId=null;$("editPreviewBanner").classList.add("hidden");$("messageTextArea").value="";onComposerInput();}
async function copySelectedMessage(){const msg=STATE.messageById.get(STATE.selectedMessageId);if(msg?.content){try{await navigator.clipboard.writeText(msg.content);showToast("Copied");}catch{showToast("Copy unavailable");}}clearMessageSelection();}
function openDeleteChoicesModal(){const msg=STATE.messageById.get(STATE.selectedMessageId);if(!msg)return;const own=msg.sender_key===STATE.currentUser.key,within=isWithinMessageActionWindow(msg);$("btnDeleteForEveryone").classList.toggle("hidden",!(own&&within));$("deleteChoicesModal").classList.remove("hidden");}
async function executeDeleteForMe(){const id=STATE.selectedMessageId;if(!id)return;try{const {error}=await STATE.supabase.rpc("delete_message_for_me",{p_message_id:id,p_identity_key:STATE.currentUser.key});if(error)throw error;STATE.messages=STATE.messages.filter(m=>m.id!==id);STATE.messageById.delete(id);closeModal("deleteChoicesModal");clearMessageSelection();renderMessagesList(false);}catch(e){showToast(e.message||"Failed to delete for me.");}}
async function executeDeleteForEveryone(){const msg=STATE.messageById.get(STATE.selectedMessageId);if(!msg||msg.sender_key!==STATE.currentUser.key||!isWithinMessageActionWindow(msg)){showToast(`Only your own messages can be deleted for everyone within ${messageActionWindowLabel()}.`);closeModal("deleteChoicesModal");return;}try{const {error}=await STATE.supabase.rpc("delete_message_everyone",{p_message_id:msg.id,p_sender_key:STATE.currentUser.key});if(error)throw error;closeModal("deleteChoicesModal");clearMessageSelection();showToast("Message deleted for everyone.");}catch(e){showToast(e.message||"Failed to delete for everyone.");}}
async function toggleMessageReaction(messageId,emoji){try{const {error}=await STATE.supabase.from("message_reactions").upsert({message_id:messageId,identity_key:STATE.currentUser.key,emoji},{onConflict:"message_id,identity_key"});if(error)throw error;const msg=STATE.messageById.get(messageId);if(msg){const list=msg.message_reactions||[];const idx=list.findIndex(r=>r.identity_key===STATE.currentUser.key);if(idx>=0)list[idx].emoji=emoji;else list.push({message_id:messageId,identity_key:STATE.currentUser.key,emoji});msg.message_reactions=list;renderSingleMessage(messageId);}}catch(e){showToast("Failed to save reaction.");}}
function renderSingleMessage(id){const old=document.querySelector(`.message-row[data-id="${CSS.escape(id)}"]`);const msg=STATE.messageById.get(id);if(!old||!msg)return;const fresh=createMessageBubbleElement(msg);old.replaceWith(fresh);if(fresh.classList.contains("counterpart"))STATE.seenObserver?.observe(fresh);}

async function removeStoragePaths(bucket,paths){for(let i=0;i<paths.length;i+=100){const batch=paths.slice(i,i+100);if(!batch.length)continue;const {error}=await STATE.supabase.storage.from(bucket).remove(batch);if(error)throw error;}}
async function executeClearChatHistory(){
  if(STATE.currentUser?.key!=="first"){showToast("Only Shadow/Thyme can delete chat history.");closeModal("clearHistoryModal");return;}
  const mode=$("clearRangeMode").value,amount=mode==="all"?null:Math.max(1,Math.min(10000,parseInt($("clearRangeAmount").value,10)||1)),unit=$("clearRangeUnit").value;
  const btn=$("btnConfirmClearHistory");setLoading(btn,true,"Deleting…");let storageCleanupFailed=false;
  try{
    const {data:deletedFiles,error}=await STATE.supabase.rpc("delete_chat_messages_by_range",{p_requester_key:"first",p_mode:mode,p_amount:amount,p_unit:unit});
    if(error)throw error;
    const referenced={"chat-media":new Set(),"chat-voice":new Set()};
    if(Array.isArray(deletedFiles))for(const item of deletedFiles){if(item?.deleted_storage_path&&referenced[item.bucket_name])referenced[item.bucket_name].add(item.deleted_storage_path);}
    // Only remove paths explicitly returned by the server. A room-wide bucket sweep
    // would also erase files belonging to pinned messages, which are exempt.
    await Promise.all(Object.entries(referenced).map(async([bucket,paths])=>{if(!paths.size)return;try{await removeStoragePaths(bucket,[...paths]);}catch(e){storageCleanupFailed=true;console.warn(`Storage delete failed for ${bucket}`,e);}}));
    closeModal("clearHistoryModal");clearMessageSelection();cancelReplyState();cancelEditState();STATE.seenMessageIds.clear();STATE.seenByCounterpart.clear();
    await loadMessages();
    if(storageCleanupFailed)showToast("Messages deleted for both people. Some stored files could not be removed by the current Storage permissions.");
    else showToast("Matching messages and attachments deleted for both people.");
  }catch(e){console.error("range delete",e);showToast(e?.message||"Failed to delete matching messages.");}
  finally{setLoading(btn,false);}
}
async function openMediaGallery(){const grid=$("mediaGalleryGrid");grid.innerHTML="";const list=[];for(const msg of STATE.messages){if(msg.is_deleted_everyone||!(msg.message_type==="image"||msg.message_type==="video"))continue;const group=getMediaGroup(msg);if(group)group.items.forEach(item=>list.push({...item,groupMessageId:msg.id}));else list.push(msg);}if(!list.length){grid.innerHTML='<p class="empty-state">No shared media yet</p>';}else{const frag=document.createDocumentFragment();for(const m of list){const type=m.message_type||((m.mime_type||"").startsWith("video/")?"video":"image");const card=document.createElement("div");card.className="gallery-card";const el=type==="image"?document.createElement("img"):document.createElement("video");el.className="gallery-thumb-item";if(el.tagName==="VIDEO"){el.muted=true;el.controls=false;el.playsInline=true;el.preload="metadata";}loadAuthorizedMediaUrl(m.storage_path,CONFIG.STORAGE.MEDIA_BUCKET).then(url=>{if(url)el.src=url;});el.onclick=()=>el.src&&openFullscreenMedia(el.src,type,m.file_name);const dl=document.createElement("a");dl.className="gallery-download";dl.href="#";dl.textContent="↓";dl.title="Download";dl.onclick=e=>{e.preventDefault();downloadStorageFile(m.storage_path,CONFIG.STORAGE.MEDIA_BUCKET,m.file_name||"media");};card.append(el,dl);frag.appendChild(card);}grid.appendChild(frag);}$("mediaGalleryOverlay").classList.remove("hidden");}
async function openVoiceGallery(){const list=$("voiceGalleryList");list.innerHTML="";const voices=STATE.messages.filter(m=>!m.is_deleted_everyone&&!(m.scheduled_for&&!m.delivered_at)&&m.message_type==="voice");if(!voices.length){list.innerHTML='<p class="empty-state">No voice messages yet</p>';}else{const frag=document.createDocumentFragment();for(const m of voices){const item=document.createElement("div");item.className="voice-gallery-item";const a=document.createElement("div");a.className="voice-gallery-author";a.textContent=`${m.sender_key===STATE.currentUser.key?STATE.currentUser.name:STATE.counterpartUser.name} • ${new Date(m.created_at).toLocaleDateString("en-GB")}`;item.append(a,createInlineVoicePlayer(m));frag.appendChild(item);}list.appendChild(frag);}$("voiceGalleryOverlay").classList.remove("hidden");}
function openFullscreenMedia(url,type,fileName){
  const ov=$("fullscreenViewerOverlay"),img=$("fullscreenImage"),vid=$("fullscreenVideo"),shell=$("videoPlayerShell"),controls=$("videoPlayerControls"),dl=$("btnDownloadFullscreen");
  dl.href=url;dl.download=fileName||`media-${Date.now()}`;$("fullscreenTitle").textContent=type==="video"?"Video":"Photo";
  vid.pause();vid.removeAttribute("src");img.removeAttribute("src");
  if(type==="image"){shell.classList.add("hidden");controls.classList.add("hidden");vid.classList.add("hidden");img.src=url;img.classList.remove("hidden");}
  else{img.classList.add("hidden");shell.classList.remove("hidden");controls.classList.remove("hidden");vid.src=url;vid.classList.remove("hidden");vid.load();vid.play().catch(()=>syncViewerVideoControls());}
  ov.classList.remove("hidden");syncViewerVideoControls();
}
function formatPlayerTime(seconds){const s=Math.max(0,Math.floor(Number(seconds)||0));return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;}
function syncViewerVideoControls(){const v=$("fullscreenVideo");if(!v)return;const duration=Number.isFinite(v.duration)?v.duration:0;$("playerCurrentTime").textContent=formatPlayerTime(v.currentTime);$("playerDuration").textContent=formatPlayerTime(duration);$("videoProgress").value=String(duration?Math.round(v.currentTime/duration*1000):0);$("btnVideoPlayPause").textContent=v.paused?"▶":"Ⅱ";$("btnVideoPlayPause").setAttribute("aria-label",v.paused?"Play video":"Pause video");$("btnVideoMute").textContent=v.muted||v.volume===0?"🔇":"🔊";$("btnVideoMute").setAttribute("aria-label",v.muted?"Unmute video":"Mute video");}
function toggleViewerVideoPlayback(){const v=$("fullscreenVideo");if(v.paused)v.play().catch(()=>showToast("Video playback could not start."));else v.pause();syncViewerVideoControls();}
function toggleViewerVideoMute(){const v=$("fullscreenVideo");v.muted=!v.muted;syncViewerVideoControls();}
function seekViewerVideo(){const v=$("fullscreenVideo");if(Number.isFinite(v.duration)&&v.duration>0)v.currentTime=(Number($("videoProgress").value)/1000)*v.duration;syncViewerVideoControls();}
function closeFullscreen(){const v=$("fullscreenVideo");v.pause();v.removeAttribute("src");v.load();$("fullscreenImage").removeAttribute("src");$("videoPlayerShell").classList.add("hidden");$("videoPlayerControls").classList.add("hidden");closeModal("fullscreenViewerOverlay");}
function openReactionDetailsModal(reactions){const list=$("reactionDetailsList");list.innerHTML="";for(const r of reactions){const row=document.createElement("div");row.style.display="flex";row.style.alignItems="center";row.style.justifyContent="space-between";row.style.padding="8px 0";const name=document.createElement("span");name.textContent=`${r.emoji} ${r.identity_key===STATE.currentUser.key?STATE.currentUser.name:STATE.counterpartUser.name}`;row.appendChild(name);if(r.identity_key===STATE.currentUser.key){const b=document.createElement("button");b.className="btn-dialog-option";b.style.width="auto";b.style.padding="6px 9px";b.textContent="Remove";b.onclick=async()=>{const {error}=await STATE.supabase.from("message_reactions").delete().eq("id",r.id);if(error)showToast("Unable to remove reaction.");else{const msg=STATE.messageById.get(r.message_id);if(msg)msg.message_reactions=(msg.message_reactions||[]).filter(x=>x.id!==r.id);closeModal("reactionDetailsModal");if(msg)renderSingleMessage(msg.id);}};row.appendChild(b);}list.appendChild(row);}$("reactionDetailsModal").classList.remove("hidden");}

async function downloadStorageFile(path,bucket,fileName){try{const {data,error}=await STATE.supabase.storage.from(bucket).createSignedUrl(path,CONFIG.URL_TTL,{download:fileName||true});if(error||!data?.signedUrl)throw error||new Error("Unavailable");const a=document.createElement("a");a.href=data.signedUrl;a.download=fileName||"download";a.rel="noopener";document.body.appendChild(a);a.click();a.remove();}catch(e){console.error(e);showToast("Download failed.");}}
async function downloadVoiceAsMp3(msg){try{showToast("Preparing MP3…");const url=await loadAuthorizedMediaUrl(msg.storage_path,CONFIG.STORAGE.VOICE_BUCKET,true);if(!url)throw new Error();const res=await fetch(url);if(!res.ok)throw new Error();const blob=await res.blob();if(blob.type.includes("mpeg")||blob.type.includes("mp3")){triggerBlobDownload(blob,changeExt(msg.file_name||`voice-${msg.id}.mp3`,`mp3`));return;}if(!window.lamejs)throw new Error("MP3 encoder unavailable");const arr=await blob.arrayBuffer(),ctx=new (window.AudioContext||window.webkitAudioContext)();const audio=await ctx.decodeAudioData(arr.slice(0));const mono=audio.numberOfChannels>1?mixToMono(audio):audio.getChannelData(0);const sampleRate=audio.sampleRate,mp3=new lamejs.Mp3Encoder(1,sampleRate,128),chunk=1152,parts=[];for(let i=0;i<mono.length;i+=chunk){const block=new Int16Array(Math.min(chunk,mono.length-i));for(let j=0;j<block.length;j++)block[j]=Math.max(-1,Math.min(1,mono[i+j]))*32767;const encoded=mp3.encodeBuffer(block);if(encoded.length)parts.push(new Int8Array(encoded));}const end=mp3.flush();if(end.length)parts.push(new Int8Array(end));const out=new Blob(parts,{type:"audio/mpeg"});triggerBlobDownload(out,changeExt(msg.file_name||`voice-${msg.id}.webm`,"mp3"));await ctx.close?.();}catch(e){console.error(e);showToast("This browser cannot convert this voice clip to MP3. Downloading original instead.");await downloadStorageFile(msg.storage_path,CONFIG.STORAGE.VOICE_BUCKET,msg.file_name||"voice.webm");}}
function mixToMono(audio){const out=new Float32Array(audio.length);for(let c=0;c<audio.numberOfChannels;c++){const ch=audio.getChannelData(c);for(let i=0;i<out.length;i++)out[i]+=ch[i]/audio.numberOfChannels;}return out;}function changeExt(name,ext){return String(name).replace(/\.[^.]+$/i,"")+`.${ext}`;}function triggerBlobDownload(blob,name){const u=URL.createObjectURL(blob),a=document.createElement("a");a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500);}

async function loadAuthorizedMediaUrl(path,bucket,refresh=false){if(!path)return null;const key=`${bucket}|${path}`,cached=STATE.mediaUrlCache.get(key);if(!refresh&&cached&&cached.expires>Date.now())return cached.url;const {data,error}=await STATE.supabase.storage.from(bucket).createSignedUrl(path,CONFIG.URL_TTL);if(error||!data?.signedUrl)return null;STATE.mediaUrlCache.set(key,{url:data.signedUrl,expires:Date.now()+CONFIG.URL_TTL*1000});return data.signedUrl;}

function setupSeenObserver(){if(STATE.seenObserver)STATE.seenObserver.disconnect();const root=$("chatMessages");if(!("IntersectionObserver" in window)){STATE.seenObserver=null;return;}STATE.seenObserver=new IntersectionObserver(entries=>{if(document.hidden||$("chatScreen").classList.contains("hidden"))return;for(const entry of entries){if(!entry.isIntersecting||entry.intersectionRatio<=0)continue;const rect=entry.intersectionRect;if(rect.height<Math.min(48,entry.boundingClientRect.height*.2))continue;const id=entry.target?.dataset?.id;const msg=id?STATE.messageById.get(id):null;if(msg&&msg.sender_key!==STATE.currentUser?.key)markMessageSeen(msg.id);}}, {root,threshold:[0,.15,.35]});}
function observeVisibleIncomingMessages(){if(!STATE.seenObserver||!STATE.currentUser||document.hidden||$("chatScreen").classList.contains("hidden"))return;document.querySelectorAll("#messagesList .message-row.counterpart").forEach(row=>STATE.seenObserver.observe(row));}
async function markMessageSeen(messageId){if(!messageId||STATE.seenMessageIds.has(messageId)||STATE.pendingSeenMessageIds.has(messageId)||!STATE.currentUser||document.hidden)return;STATE.pendingSeenMessageIds.add(messageId);try{const {data,error}=await STATE.supabase.rpc("mark_message_seen",{p_message_id:messageId});if(error)throw error;if(data!==false)STATE.seenMessageIds.add(messageId);}catch(e){console.warn("Unable to save seen receipt",e);if(!STATE.seenSchemaWarningShown){STATE.seenSchemaWarningShown=true;showToast("Apply the follow-up Supabase SQL to enable seen receipts.");}}finally{STATE.pendingSeenMessageIds.delete(messageId);}}
function handleRealtimeSeenReceiptChange(payload){const receipt=payload?.new;if(!receipt||receipt.seen_by_identity_key!==STATE.counterpartUser?.key)return;STATE.seenByCounterpart.add(receipt.message_id);if(STATE.messageById.has(receipt.message_id))renderSingleMessage(receipt.message_id);}

function subscribeRealtime(){
  if(STATE.realtimeChannel)STATE.supabase.removeChannel(STATE.realtimeChannel);
  const channel=STATE.supabase.channel(`rs_room_${STATE.roomId}`)
    .on("postgres_changes",{event:"INSERT",schema:"public",table:"messages",filter:`room_id=eq.${STATE.roomId}`},handleRealtimeMessageChange)
    .on("postgres_changes",{event:"UPDATE",schema:"public",table:"messages",filter:`room_id=eq.${STATE.roomId}`},handleRealtimeMessageChange)
    .on("postgres_changes",{event:"DELETE",schema:"public",table:"messages",filter:`room_id=eq.${STATE.roomId}`},handleRealtimeMessageChange)
    .on("postgres_changes",{event:"*",schema:"public",table:"message_reactions"},handleRealtimeReactionChange)
    .on("postgres_changes",{event:"INSERT",schema:"public",table:"message_seen_receipts"},handleRealtimeSeenReceiptChange)
    .on("postgres_changes",{event:"*",schema:"public",table:"presence"},handleRealtimePresenceChange)
    .on("broadcast",{event:"typing"},handleRealtimeActivity)
    .on("broadcast",{event:"recording"},handleRealtimeActivity);
  STATE.realtimeChannel=channel.subscribe(status=>{
    const b=$("connectionBanner");
    b.classList.toggle("hidden",status==="SUBSCRIBED");
    if(status==="CHANNEL_ERROR"||status==="TIMED_OUT")setTimeout(()=>{if(STATE.currentUser&&STATE.roomId)subscribeRealtime();},2000);
  });
}
function handleRealtimeMessageChange(payload){
  if(!payload?.eventType||!STATE.roomId)return;
  if(payload.eventType==="INSERT"){
    const m=payload.new;if(!m||m.room_id!==STATE.roomId||STATE.messageById.has(m.id))return;
    // Follow new messages only if the user was already at the bottom.
    // Otherwise preserve their reading position and offer a jump-to-latest button.
    const shouldStickToBottom=isNearBottom();
    const message={...m,message_reactions:m.message_reactions||[],message_visibility:m.message_visibility||[]};STATE.messages.push(message);STATE.messageById.set(message.id,message);STATE.messages.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
    if(!shouldStickToBottom&&message.sender_key!==STATE.currentUser?.key){STATE.pendingNewMessagesBelow=(STATE.pendingNewMessagesBelow||0)+1;updateJumpToLatestButton();}
    renderMessagesList(shouldStickToBottom);return;
  }
  if(payload.eventType==="UPDATE"){
    const id=payload.new?.id;if(!id)return;
    const idx=STATE.messages.findIndex(x=>x.id===id);
    if(idx<0){loadMessages();return;}
    STATE.messages[idx]={...STATE.messages[idx],...payload.new};STATE.messageById.set(id,STATE.messages[idx]);renderSingleMessage(id);return;
  }
  if(payload.eventType==="DELETE"){
    const id=payload.old?.id;if(!id)return;
    STATE.messages=STATE.messages.filter(x=>x.id!==id);STATE.messageById.delete(id);renderMessagesList(false);
  }
}
function handleRealtimeReactionChange(payload){const id=payload.new?.message_id||payload.old?.message_id;if(!id||!STATE.messageById.has(id))return;loadMessageReactions(id);}
async function loadMessageReactions(messageId){const {data,error}=await STATE.supabase.from("message_reactions").select("*").eq("message_id",messageId);if(error)return;const m=STATE.messageById.get(messageId);if(!m)return;m.message_reactions=data||[];renderSingleMessage(messageId);}
function handleRealtimePresenceChange(payload){const row=payload.new||payload.old;if(!row||row.identity_key!==STATE.counterpartUser.key)return;updatePresenceStatusUI(row.is_online,row.last_seen,false,row.updated_at);}
async function loadCounterpartPresence(){const {data,error}=await STATE.supabase.from("presence").select("identity_key,is_online,last_seen,updated_at").eq("identity_key",STATE.counterpartUser.key).maybeSingle();if(!error&&data)updatePresenceStatusUI(data.is_online,data.last_seen,true,data.updated_at);}
function updatePresenceStatusUI(isOnline,lastSeen,bootstrap=false,updatedAt=null){const status=$("counterpartStatus"),dot=$("counterpartStatusDot");let fresh=!!isOnline;const stamp=updatedAt||lastSeen;if(fresh&&stamp&&Date.now()-new Date(stamp).getTime()>CONFIG.PRESENCE_STALE_MS)fresh=false;dot.classList.toggle("online",fresh);dot.classList.toggle("offline",!fresh);status.classList.toggle("online",fresh);if(fresh){status.textContent="Online";}else if(lastSeen){status.textContent=`Last seen ${formatLastSeen(new Date(lastSeen))}`;}else status.textContent="Offline";STATE.presenceBootstrapped=true;}
function formatLastSeen(d){const now=new Date(),same=now.toDateString()===d.toDateString(),y=new Date(now);y.setDate(now.getDate()-1);if(same)return`today at ${d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}`;if(y.toDateString()===d.toDateString())return`yesterday at ${d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}`;return`${d.toLocaleDateString("en-GB",{day:"2-digit",month:"short",year:"numeric"})} at ${d.toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})}`;}
function startPresenceHeartbeat(){sendHeartbeat(true);clearInterval(STATE.heartbeatIntervalId);STATE.heartbeatIntervalId=setInterval(()=>{if(document.hidden)return;sendHeartbeat(true);},15000);}
async function sendHeartbeat(isOnline){if(!STATE.currentUser)return;try{await STATE.supabase.rpc("update_presence_heartbeat",{p_identity_key:STATE.currentUser.key,p_is_online:isOnline});}catch(e){console.warn("presence",e);}}
function scrollToBottom(smooth=true){const c=$("chatMessages");c.scrollTo({top:c.scrollHeight,behavior:smooth?"smooth":"auto"});if(!smooth){STATE.pendingNewMessagesBelow=0;updateJumpToLatestButton();}else{setTimeout(()=>{if(isNearBottom()){STATE.pendingNewMessagesBelow=0;updateJumpToLatestButton();}},350);}}
