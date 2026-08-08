from pathlib import Path
import json
import re

ROOT = Path('.')


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 exact match, found {count}')
    return text.replace(old, new, 1)


def replace_function(text, name, new_source, async_fn=None):
    if async_fn is None:
        prefix = r'(?:async\s+)?'
    elif async_fn:
        prefix = r'async\s+'
    else:
        prefix = ''
    pattern = rf'^{prefix}function\s+{re.escape(name)}\([^\n]*\)\{{.*?^\}}\n'
    updated, count = re.subn(pattern, new_source.rstrip() + '\n', text, count=1, flags=re.M | re.S)
    if count != 1:
        raise RuntimeError(f'function {name}: expected 1 match, found {count}')
    return updated


# ---------------------------------------------------------------------------
# index.html — consolidate duplicated auth, face, form and event logic.
# ---------------------------------------------------------------------------
index = read('index.html')

anchor = "tick();AppState[timerKey]=setInterval(tick,1000);}\n\n/* ===== LOGIN ===== */"
helpers = r'''tick();AppState[timerKey]=setInterval(tick,1000);}

function parseApiError(error,fallback='Terjadi kesalahan'){
  const raw=String(error&&error.message?error.message:fallback||'Terjadi kesalahan');
  const parts=raw.split('::');
  return {code:parts.length>1?parts[0]:'',message:parts.length>1?parts.slice(1).join('::'):raw};
}

async function withBusyButton(button,loadingHtml,task){
  if(!button)return task();
  const original=button.innerHTML;
  button.disabled=true;
  button.innerHTML=loadingHtml;
  try{return await task();}
  finally{button.disabled=false;button.innerHTML=original;}
}

function bindEvents(ids,eventName,handler){
  ids.forEach(id=>document.getElementById(id)?.addEventListener(eventName,handler));
}
function bindClicks(ids,handler){bindEvents(ids,'click',handler);}
function bindAccessibleActivation(element,handler){
  if(!element)return;
  element.addEventListener('click',handler);
  element.addEventListener('keydown',event=>{
    if(event.key!=='Enter'&&event.key!==' ')return;
    event.preventDefault();handler(event);
  });
}
function parseDateValue(value){
  if(!value)return null;
  const date=new Date(value);
  return Number.isNaN(date.getTime())?null:date;
}
function userField(user,...keys){
  for(const key of keys){const value=user?.[key];if(value!==undefined&&value!==null)return value;}
  return '';
}
function dateInputValue(value){return value?String(value).split('T')[0]:'';}
function normalizeUserEditorData(user){
  return {
    idUser:userField(user,'ID_User','idUser'),
    nama:userField(user,'Nama_Lengkap','nama_lengkap','namaLengkap'),
    username:userField(user,'Username','username'),
    email:userField(user,'Email','email'),
    wa:userField(user,'No_Whatsapp','no_whatsapp','noWhatsapp'),
    tempatLahir:userField(user,'Tempat_Lahir','tempat_lahir','tempatLahir'),
    tanggalLahir:dateInputValue(userField(user,'Tanggal_Lahir','tanggal_lahir','tanggalLahir')),
    jenisKelamin:userField(user,'Jenis_Kelamin','jenis_kelamin','jenisKelamin'),
    sppg:userField(user,'SPPG','sppg'),
    jabatan:userField(user,'Jabatan_Divisi','jabatan_divisi','jabatanDivisi'),
    mulaiKerja:dateInputValue(userField(user,'Tanggal_Mulai_Kerja','tanggal_mulai_kerja','tanggalMulaiKerja')),
    gaji:userField(user,'Gaji_Harian','gaji_harian','gajiHarian'),
    bank:userField(user,'Nama_Bank','nama_bank','namaBank'),
    nomorRekening:userField(user,'Nomor_Rekening','nomor_rekening','nomorRekening'),
    atasNamaRekening:userField(user,'Atas_Nama_Rekening','atas_nama_rekening','atasNamaRekening'),
    foto:userField(user,'URL_Foto_Profil','urlFotoProfil')
  };
}
function populateInputs(values){
  Object.entries(values).forEach(([selector,value])=>{const input=$(selector);if(input)input.value=value??'';});
}

async function verifyOtpFlow({alertId,rowId,buttonId,apiFunction,payload,onSuccess,errorFallback='Kode OTP salah'}){
  hideInlineAlert(alertId);
  const kode=getOtpValue(rowId);
  if(kode.length!==6){showInlineAlert(alertId,'Masukkan 6 digit kode verifikasi','warning');return false;}
  const button=$(buttonId);
  return withBusyButton(button,'<div class="spinner" style="width:20px;height:20px;border-width:2px"></div> Memverifikasi...',async()=>{
    try{
      const result=await apiCall(apiFunction,payload(kode));
      if(result&&result.success){await onSuccess(result);return true;}
      showInlineAlert(alertId,result?.message||'Verifikasi gagal');
    }catch(error){
      showInlineAlert(alertId,parseApiError(error,errorFallback).message);
      clearOtpRow(rowId);
    }
    return false;
  });
}

async function resendOtpFlow({buttonId,alertId,email,apiFunction,rowId,countdownId,timerKey}){
  const button=$(buttonId);if(button?.classList.contains('disabled'))return false;
  hideInlineAlert(alertId);
  try{
    const result=await apiCall(apiFunction,{email});
    if(result&&result.success){
      showAlert(result.message||'Kode berhasil dikirim ulang','success');
      startResendCountdown(result.cooldownDetik||120,buttonId.slice(1),countdownId.slice(1),timerKey);
      clearOtpRow(rowId);
      return true;
    }
  }catch(error){
    const parsed=parseApiError(error,'Gagal mengirim ulang kode');
    showInlineAlert(alertId,parsed.message,'warning');
  }
  return false;
}

/* ===== LOGIN ===== */'''
index = replace_once(index, anchor, helpers, 'shared helper insertion')

# Date formatters share one parser while preserving their existing output contracts.
index = index.replace("function formatTanggal(v){if(!v)return'-';const d=new Date(v);if(isNaN(d))return'-';return d.toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});}",
                      "function formatTanggal(v){const d=parseDateValue(v);if(!d)return'-';return d.toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});}")
index = index.replace("function formatWaktu(v){if(!v)return'-';const d=new Date(v);if(isNaN(d))return v;return d.toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'})+' '+d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});}",
                      "function formatWaktu(v){const d=parseDateValue(v);if(!d)return v||'-';return d.toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'})+' '+d.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});}")
index = index.replace("function formatDateTime(value){if(!value)return'-';const date=new Date(value);if(Number.isNaN(date.getTime()))return'-';return date.toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'});}",
                      "function formatDateTime(value){const date=parseDateValue(value);if(!date)return'-';return date.toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'});}")

index = replace_function(index, 'handleLogin', r'''async function handleLogin(){
  hideInlineAlert('login-alert');
  $('#btn-goto-forgot').classList.remove('show');
  const e=$('#login-email').value.trim(),p=$('#login-password').value;
  if(!e||!p){showInlineAlert('login-alert','Mohon isi email dan password','warning');return;}
  const button=$('#btn-login');
  await withBusyButton(button,'<div class="spinner" style="width:20px;height:20px;border-width:2px"></div> Memproses...',async()=>{
    try{
      const r=await apiCall('login',{email:e,username:e,password:p});
      if(r&&r.token){
        AppState.token=r.token;AppState.user=r;
        localStorage.setItem('auth_token',r.token);localStorage.setItem('auth_user',JSON.stringify(r));
        showAlert('Login berhasil!','success');showApp();loadProfilLengkap();
        return;
      }
      showInlineAlert('login-alert',r?.message||'Login gagal');
    }catch(error){
      const parsed=parseApiError(error);
      showInlineAlert('login-alert',parsed.message,['AKUN_DIBEKUKAN','EMAIL_BELUM_VERIFIKASI'].includes(parsed.code)?'warning':'error');
      if(parsed.code==='PASSWORD_SALAH_TAMPIL_RESET'){
        $('#btn-goto-forgot').classList.add('show');$('#forgot-email').value=e;
      }
    }
  });
}''', async_fn=True)

index = replace_function(index, 'handleRegister', r'''async function handleRegister(){
  const n=$('#reg-nama').value.trim(),u=$('#reg-username').value.trim(),e=$('#reg-email').value.trim(),ce=$('#reg-confirm-email').value.trim(),p=$('#reg-password').value,cp=$('#reg-confirm-password').value,s=$('#reg-setuju').checked;
  if(!n||!u||!e||!p){showAlert('Semua field wajib diisi','warning');return;}
  if(e!==ce){showAlert('Email konfirmasi tidak cocok','error');return;}
  if(p!==cp){showAlert('Password konfirmasi tidak cocok','error');return;}
  if(p.length<6){showAlert('Password minimal 6 karakter','warning');return;}
  if(!s){showAlert('Anda harus menyetujui kebijakan','warning');return;}
  await withBusyButton($('#btn-register'),'<div class="spinner" style="width:20px;height:20px;border-width:2px"></div> Mendaftar...',async()=>{
    try{
      const r=await apiCall('registerUser',{namaLengkap:n,username:u,email:e,password:p,role:'user'});
      if(r&&r.success){
        AppState.pendingRegisterEmail=e;$('#verify-register-email').textContent=e;
        showAlert('Registrasi berhasil! Silakan cek email untuk kode verifikasi.','success');
        navigateTo('verify-register');startResendCountdown(120,'btn-resend-register','resend-register-countdown','resendTimerRegister');
      }else showAlert(r?.message||'Registrasi gagal','error');
    }catch(error){showAlert(parseApiError(error).message,'error');}
  });
}''', async_fn=True)

index = replace_function(index, 'handleVerifyRegister', r'''async function handleVerifyRegister(){
  return verifyOtpFlow({
    alertId:'verify-register-alert',rowId:'verify-register-otp-row',buttonId:'#btn-verify-register',
    apiFunction:'verifyRegistrationOtp',payload:kode=>({email:AppState.pendingRegisterEmail,kodeOtp:kode}),
    onSuccess:()=>{showAlert('Email berhasil diverifikasi! Silakan login.','success');if(AppState.resendTimerRegister)clearInterval(AppState.resendTimerRegister);navigateTo('login');}
  });
}''', async_fn=True)
index = replace_function(index, 'handleResendRegister', r'''async function handleResendRegister(){
  return resendOtpFlow({buttonId:'#btn-resend-register',alertId:'verify-register-alert',email:AppState.pendingRegisterEmail,apiFunction:'resendConfirmationEmail',rowId:'verify-register-otp-row',countdownId:'#resend-register-countdown',timerKey:'resendTimerRegister'});
}''', async_fn=True)

index = replace_function(index, 'handleForgotPassword', r'''async function handleForgotPassword(){
  hideInlineAlert('forgot-password-alert');
  const email=$('#forgot-email').value.trim();
  if(!email){showInlineAlert('forgot-password-alert','Mohon isi email','warning');return;}
  await withBusyButton($('#btn-forgot-password'),'<div class="spinner" style="width:20px;height:20px;border-width:2px"></div> Mengirim...',async()=>{
    try{
      const r=await apiCall('requestResetPasswordByEmail',{email});
      if(r&&r.success){
        AppState.pendingResetEmail=email;$('#verify-reset-email').textContent=email;
        showAlert('Kode reset password telah dikirim ke email Anda.','success');navigateTo('verify-reset');
        startResendCountdown(r.cooldownDetik||120,'btn-resend-reset','resend-reset-countdown','resendTimerReset');
      }else showInlineAlert('forgot-password-alert',r?.message||'Gagal mengirim kode reset');
    }catch(error){const parsed=parseApiError(error);showInlineAlert('forgot-password-alert',parsed.message,parsed.code==='TUNGGU'?'warning':'error');}
  });
}''', async_fn=True)
index = replace_function(index, 'handleVerifyReset', r'''async function handleVerifyReset(){
  return verifyOtpFlow({
    alertId:'verify-reset-alert',rowId:'verify-reset-otp-row',buttonId:'#btn-verify-reset',
    apiFunction:'verifyResetPasswordOtp',payload:kode=>({email:AppState.pendingResetEmail,kodeOtp:kode}),
    onSuccess:r=>{AppState.pendingResetToken=r.resetToken;if(AppState.resendTimerReset)clearInterval(AppState.resendTimerReset);navigateTo('new-password');}
  });
}''', async_fn=True)
index = replace_function(index, 'handleResendReset', r'''async function handleResendReset(){
  return resendOtpFlow({buttonId:'#btn-resend-reset',alertId:'verify-reset-alert',email:AppState.pendingResetEmail,apiFunction:'requestResetPasswordByEmail',rowId:'verify-reset-otp-row',countdownId:'#resend-reset-countdown',timerKey:'resendTimerReset'});
}''', async_fn=True)
index = replace_function(index, 'handleUpdatePassword', r'''async function handleUpdatePassword(){
  hideInlineAlert('new-password-alert');
  const p=$('#new-password').value,cp=$('#new-password-confirm').value;
  if(!p||!cp){showInlineAlert('new-password-alert','Mohon isi password baru dan konfirmasi','warning');return;}
  if(p!==cp){showInlineAlert('new-password-alert','Konfirmasi password tidak cocok');return;}
  if(p.length<6){showInlineAlert('new-password-alert','Password minimal 6 karakter','warning');return;}
  await withBusyButton($('#btn-update-password'),'<div class="spinner" style="width:20px;height:20px;border-width:2px"></div> Memperbarui...',async()=>{
    try{
      const r=await apiCall('resetPassword',{email:AppState.pendingResetEmail,token:AppState.pendingResetToken,newPassword:p});
      if(r&&r.success){
        showAlert('Password berhasil diubah! Silakan login.','success');$('#new-password').value='';$('#new-password-confirm').value='';
        AppState.pendingResetEmail='';AppState.pendingResetToken='';navigateTo('login');
      }else showInlineAlert('new-password-alert',r?.message||'Gagal update password');
    }catch(error){showInlineAlert('new-password-alert',parseApiError(error).message);}
  });
}''', async_fn=True)

# Normalize profile/admin form population from one canonical user shape.
index = replace_function(index, 'openAdminUpdateUserModal', r'''function openAdminUpdateUserModal(){
  const u=AdminState.selectedUser;if(!u)return;
  const data=normalizeUserEditorData(u);
  hideInlineAlert('admin-update-user-alert');
  populateInputs({
    '#admin-update-user-id':data.idUser,'#auu-nama':data.nama,'#auu-wa':data.wa,'#auu-tempat-lahir':data.tempatLahir,
    '#auu-tanggal-lahir':data.tanggalLahir,'#auu-jk':data.jenisKelamin,'#auu-sppg':data.sppg,'#auu-jabatan':data.jabatan,
    '#auu-mulai-kerja':data.mulaiKerja,'#auu-gaji':data.gaji,'#auu-bank':data.bank,'#auu-nomor-rekening':data.nomorRekening,'#auu-rekening':data.atasNamaRekening
  });
  $('#modal-admin-update-user').classList.add('active');
}''', async_fn=False)
index = replace_function(index, 'openEditProfil', r'''function openEditProfil(){
  const u=AppState.user;if(!u)return;
  const data=normalizeUserEditorData(u);
  hideInlineAlert('edit-profil-alert');
  const avatar=$('#edit-profil-avatar');
  if(data.foto)avatar.innerHTML=`<img src="${data.foto}" alt="Foto profil">`;
  else avatar.textContent=data.nama?String(data.nama).trim().charAt(0).toUpperCase():'?';
  populateInputs({
    '#edit-nama':data.nama,'#edit-username':data.username,'#edit-tempat-lahir':data.tempatLahir,'#edit-tanggal-lahir':data.tanggalLahir,
    '#edit-jk':data.jenisKelamin,'#edit-email':data.email,'#edit-wa':data.wa,'#edit-bank':data.bank,
    '#edit-nomor-rekening':data.nomorRekening,'#edit-rekening':data.atasNamaRekening
  });
  $('#modal-edit-profil').classList.add('active');
}''', async_fn=False)

index = replace_function(index, 'handleSaveAdminUpdateUser', r'''async function handleSaveAdminUpdateUser(){
  hideInlineAlert('admin-update-user-alert');
  const userId=$('#admin-update-user-id').value;if(!userId){showInlineAlert('admin-update-user-alert','ID user tidak ditemukan');return;}
  const updates={Nama_Lengkap:$('#auu-nama').value.trim(),No_Whatsapp:$('#auu-wa').value.trim(),Tempat_Lahir:$('#auu-tempat-lahir').value.trim(),Tanggal_Lahir:$('#auu-tanggal-lahir').value||null,Jenis_Kelamin:$('#auu-jk').value,SPPG:$('#auu-sppg').value.trim(),Jabatan_Divisi:$('#auu-jabatan').value.trim(),Tanggal_Mulai_Kerja:$('#auu-mulai-kerja').value||null,Gaji_Harian:$('#auu-gaji').value?Number($('#auu-gaji').value):null,Nama_Bank:$('#auu-bank').value.trim(),Nomor_Rekening:$('#auu-nomor-rekening').value.trim(),Atas_Nama_Rekening:$('#auu-rekening').value.trim()};
  if(!updates.Nama_Lengkap){showInlineAlert('admin-update-user-alert','Nama lengkap tidak boleh kosong','warning');return;}
  await withBusyButton($('#btn-save-admin-update-user'),'<div class="spinner" style="width:18px;height:18px;border-width:2px"></div> Menyimpan...',async()=>{
    try{
      const r=await apiCall('updateData',{token:AppState.token,menu:'users',id:userId,data:updates});
      if(r&&r.success){showAlert('Data user berhasil diperbarui','success');Object.assign(AdminState.selectedUser,updates);openUserDetail(AdminState.filteredUsers.indexOf(AdminState.selectedUser));$('#modal-admin-update-user').classList.remove('active');loadAdminUsers();}
      else showInlineAlert('admin-update-user-alert',r?.message||'Gagal memperbarui data');
    }catch(error){showInlineAlert('admin-update-user-alert',parseApiError(error).message);}
  });
}''', async_fn=True)
index = replace_function(index, 'handleSaveEditProfil', r'''async function handleSaveEditProfil(){
  hideInlineAlert('edit-profil-alert');
  const updates={Nama_Lengkap:$('#edit-nama').value.trim(),Tempat_Lahir:$('#edit-tempat-lahir').value.trim(),Tanggal_Lahir:$('#edit-tanggal-lahir').value||null,Jenis_Kelamin:$('#edit-jk').value,Email:$('#edit-email').value.trim(),No_Whatsapp:$('#edit-wa').value.trim(),Nama_Bank:$('#edit-bank').value.trim(),Nomor_Rekening:$('#edit-nomor-rekening').value.trim(),Atas_Nama_Rekening:$('#edit-rekening').value.trim()};
  if(!updates.Nama_Lengkap){showInlineAlert('edit-profil-alert','Nama lengkap tidak boleh kosong','warning');return;}
  await withBusyButton($('#btn-save-edit-profil'),'<div class="spinner" style="width:18px;height:18px;border-width:2px"></div> Menyimpan...',async()=>{
    try{
      const r=await apiCall('updateProfil',{token:AppState.token,updates});
      if(r&&r.success){showAlert('Profil berhasil diperbarui','success');await loadProfilLengkap();closeEditProfil();}
      else showInlineAlert('edit-profil-alert',r?.message||'Gagal memperbarui profil');
    }catch(error){showInlineAlert('edit-profil-alert',parseApiError(error).message);}
  });
}''', async_fn=True)

# Consolidate camera lifecycle and face detection into one engine.
face_anchor = "const FACE_SMILE_THRESHOLD=0.7;\n"
face_helpers = r'''const FACE_SMILE_THRESHOLD=0.7;

function resetFaceSessionState(state){state.smileHoldMs=0;state.lastTs=0;state.busy=false;}
async function startFaceCameraSession({state,videoSelector,canvasSelector,statusSelector,beforeDetection,onDetect}){
  resetFaceSessionState(state);
  const status=$(statusSelector);if(status)status.textContent='Memuat kamera...';
  state.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:480},height:{ideal:480}},audio:false});
  const video=$(videoSelector);video.srcObject=state.stream;
  await new Promise(resolve=>{video.onloadedmetadata=()=>resolve();});
  if(status)status.textContent='Memuat model deteksi wajah...';
  await loadFaceApiModels();
  const canvas=$(canvasSelector);canvas.width=video.videoWidth||480;canvas.height=video.videoHeight||480;
  if(beforeDetection)await beforeDetection();
  if(status)status.textContent='Posisikan wajah di dalam bingkai';
  onDetect();
}
function stopFaceCameraSession(state,canvasSelector){
  if(state.detectLoop)cancelAnimationFrame(state.detectLoop);state.detectLoop=null;
  if(state.stream){state.stream.getTracks().forEach(track=>track.stop());state.stream=null;}
  const canvas=$(canvasSelector);if(canvas){const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);}
}
async function runFaceDetectionLoop({state,videoSelector,canvasSelector,statusSelector,progressSelector,smilePrompt,onComplete,reschedule}){
  if(state.busy){state.detectLoop=requestAnimationFrame(reschedule);return;}
  const video=$(videoSelector),canvas=$(canvasSelector);
  if(!video||video.readyState<2){state.detectLoop=requestAnimationFrame(reschedule);return;}
  const opts=new faceapi.TinyFaceDetectorOptions({inputSize:224,scoreThreshold:0.5});
  const result=await faceapi.detectSingleFace(video,opts).withFaceLandmarks().withFaceExpressions().withFaceDescriptor();
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
  const now=performance.now(),dt=state.lastTs?now-state.lastTs:0;state.lastTs=now;
  if(!result){state.smileHoldMs=0;$(statusSelector).textContent='Wajah tidak terdeteksi';$(progressSelector).style.width='0%';state.detectLoop=requestAnimationFrame(reschedule);return;}
  const box=result.detection.box;ctx.strokeStyle='#4f46e5';ctx.lineWidth=3;ctx.strokeRect(box.x,box.y,box.width,box.height);
  const smileScore=(result.expressions&&result.expressions.happy)||0;
  if(smileScore>=FACE_SMILE_THRESHOLD){state.smileHoldMs=Math.min(FACE_SMILE_HOLD_TARGET_MS,state.smileHoldMs+dt);$(statusSelector).textContent='Bagus, tahan senyumnya...';}
  else{state.smileHoldMs=Math.max(0,state.smileHoldMs-dt*2);$(statusSelector).textContent=smilePrompt;}
  $(progressSelector).style.width=Math.round((state.smileHoldMs/FACE_SMILE_HOLD_TARGET_MS)*100)+'%';
  if(state.smileHoldMs>=FACE_SMILE_HOLD_TARGET_MS){state.busy=true;await onComplete(result);return;}
  state.detectLoop=requestAnimationFrame(reschedule);
}
'''
index = replace_once(index, face_anchor, face_helpers, 'face helper insertion')

index = replace_function(index, 'openDaftarWajah', r'''async function openDaftarWajah(){
  hideInlineAlert('daftar-wajah-alert');$('#facecam-progress-bar').style.width='0%';$('#modal-daftar-wajah').classList.add('active');
  try{await startFaceCameraSession({state:FaceRegState,videoSelector:'#facecam-video',canvasSelector:'#facecam-canvas',statusSelector:'#facecam-status',onDetect:faceRegDetectLoop});}
  catch(error){console.error(error);$('#facecam-status').textContent='';showInlineAlert('daftar-wajah-alert',error&&error.name==='NotAllowedError'?'Izin kamera ditolak. Aktifkan akses kamera untuk melanjutkan.':'Gagal mengakses kamera.');}
}''', async_fn=True)
index = replace_function(index, 'closeDaftarWajah', r'''function closeDaftarWajah(){
  $('#modal-daftar-wajah').classList.remove('active');stopFaceCameraSession(FaceRegState,'#facecam-canvas');
}''', async_fn=False)
index = replace_function(index, 'faceRegDetectLoop', r'''async function faceRegDetectLoop(){
  return runFaceDetectionLoop({state:FaceRegState,videoSelector:'#facecam-video',canvasSelector:'#facecam-canvas',statusSelector:'#facecam-status',progressSelector:'#facecam-progress-bar',smilePrompt:'Tersenyumlah untuk melanjutkan',reschedule:faceRegDetectLoop,onComplete:result=>handleFaceCaptureComplete(result.descriptor,$('#facecam-video'))});
}''', async_fn=True)
index = replace_function(index, 'openAbsenScan', r'''async function openAbsenScan(){
  const overlay=$('#absen-result-overlay');overlay.classList.remove('show','success','error');
  $('#absen-facecam-hint').textContent='Posisikan wajah Anda di dalam bingkai, lalu tersenyumlah';$('#absen-progress-bar').style.width='0%';AbsenScanState.coords=null;
  try{await startFaceCameraSession({state:AbsenScanState,videoSelector:'#absen-facecam-video',canvasSelector:'#absen-facecam-canvas',statusSelector:'#absen-facecam-status',beforeDetection:async()=>{$('#absen-facecam-status').textContent='Mendeteksi lokasi Anda...';AbsenScanState.coords=await getCurrentPositionPromise();},onDetect:absenScanDetectLoop});}
  catch(error){console.error(error);$('#absen-facecam-status').textContent=error&&error.name==='NotAllowedError'?'Izin kamera ditolak. Aktifkan akses kamera untuk melanjutkan.':'Gagal mengakses kamera.';}
}''', async_fn=True)
index = replace_function(index, 'closeAbsenScan', r'''function closeAbsenScan(){stopFaceCameraSession(AbsenScanState,'#absen-facecam-canvas');}''', async_fn=False)
index = replace_function(index, 'absenScanDetectLoop', r'''async function absenScanDetectLoop(){
  return runFaceDetectionLoop({state:AbsenScanState,videoSelector:'#absen-facecam-video',canvasSelector:'#absen-facecam-canvas',statusSelector:'#absen-facecam-status',progressSelector:'#absen-progress-bar',smilePrompt:'Tersenyumlah untuk absen',reschedule:absenScanDetectLoop,onComplete:result=>handleAbsenScanComplete(result.descriptor)});
}''', async_fn=True)

# Logout always attempts server revocation before local cleanup.
index = replace_function(index, 'handleLogout', r'''async function handleLogout(){
  try{if(AppState.token)await apiCall('logout',{token:AppState.token});}
  catch(error){console.warn('Server session revoke failed during logout.',error);}
  finally{localStorage.removeItem('auth_token');localStorage.removeItem('auth_user');sessionStorage.clear();AppState.token=null;AppState.user=null;clearApiResponseCache();showAuth();navigateTo('login');}
}''', async_fn=None)

# Cookie restoration is authoritative on canonical production; storage marker is compatibility only.
index = replace_function(index, 'checkSession', r'''async function checkSession(){
  try{if(window.HadirlyCookieSession?.restoreCookieSession)await window.HadirlyCookieSession.restoreCookieSession();}catch{}
  const st=localStorage.getItem('auth_token'),su=localStorage.getItem('auth_user');
  if(!st||!su){localStorage.removeItem('auth_token');localStorage.removeItem('auth_user');return false;}
  try{const r=await apiCall('checkSession',{token:st});if(r&&r.valid){AppState.token=st;AppState.user=r.user||JSON.parse(su);return true;}}
  catch(error){console.error(error);}
  localStorage.removeItem('auth_token');localStorage.removeItem('auth_user');return false;
}''', async_fn=True)

# Consolidate identical listener registrations without changing semantics.
index = index.replace("  $('#btn-to-login').addEventListener('click',()=>navigateTo('login'));", "  bindClicks(['btn-to-login','btn-verify-register-to-login','btn-forgot-to-login','btn-verify-reset-to-login'],()=>navigateTo('login'));")
for duplicate in [
    "  $('#btn-verify-register-to-login').addEventListener('click',()=>navigateTo('login'));\n",
    "  $('#btn-forgot-to-login').addEventListener('click',()=>navigateTo('login'));\n",
    "  $('#btn-verify-reset-to-login').addEventListener('click',()=>navigateTo('login'));\n",
]:
    index = index.replace(duplicate, '')

pairs = [
    ("  $('#btn-close-payroll-publish')?.addEventListener('click',closePayrollPublishModal);\n  $('#btn-cancel-payroll-publish')?.addEventListener('click',closePayrollPublishModal);", "  bindClicks(['btn-close-payroll-publish','btn-cancel-payroll-publish'],closePayrollPublishModal);"),
    ("  $('#btn-close-recipient-signature')?.addEventListener('click',closeRecipientSignatureModal);\n  $('#btn-cancel-recipient-signature')?.addEventListener('click',closeRecipientSignatureModal);", "  bindClicks(['btn-close-recipient-signature','btn-cancel-recipient-signature'],closeRecipientSignatureModal);"),
    ("  $('#btn-close-risk')?.addEventListener('click',()=>closeRiskConfirmation(null));\n  $('#btn-cancel-risk')?.addEventListener('click',()=>closeRiskConfirmation(null));", "  bindClicks(['btn-close-risk','btn-cancel-risk'],()=>closeRiskConfirmation(null));"),
    ("  $('#btn-close-profile-password').addEventListener('click',closeProfilePasswordModal);\n  $('#btn-cancel-profile-password').addEventListener('click',closeProfilePasswordModal);", "  bindClicks(['btn-close-profile-password','btn-cancel-profile-password'],closeProfilePasswordModal);"),
    ("  $('#btn-close-daftar-wajah').addEventListener('click',closeDaftarWajah);\n  $('#btn-cancel-daftar-wajah').addEventListener('click',closeDaftarWajah);", "  bindClicks(['btn-close-daftar-wajah','btn-cancel-daftar-wajah'],closeDaftarWajah);"),
    ("  $('#btn-close-edit-profil').addEventListener('click',closeEditProfil);\n  $('#btn-cancel-edit-profil').addEventListener('click',closeEditProfil);", "  bindClicks(['btn-close-edit-profil','btn-cancel-edit-profil'],closeEditProfil);"),
    ("  $('#btn-close-crop-foto').addEventListener('click',closeCropModal);\n  $('#btn-cancel-crop-foto').addEventListener('click',closeCropModal);", "  bindClicks(['btn-close-crop-foto','btn-cancel-crop-foto'],closeCropModal);"),
    ("  $('#payroll-period-start')?.addEventListener('change',()=>{FeatureState.payrollPreview={};renderAdminPayroll();});\n  $('#payroll-period-end')?.addEventListener('change',()=>{FeatureState.payrollPreview={};renderAdminPayroll();});", "  bindEvents(['payroll-period-start','payroll-period-end'],'change',()=>{FeatureState.payrollPreview={};renderAdminPayroll();});"),
]
for old, new in pairs:
    if old not in index:
        raise RuntimeError('event consolidation pattern missing: ' + old[:80])
    index = index.replace(old, new, 1)

# Accessible card activation is one helper instead of duplicated click/keyboard logic.
index = index.replace("row.addEventListener('click',()=>openUserDetail(idx));row.addEventListener('keydown',(event)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openUserDetail(idx);}});", "bindAccessibleActivation(row,()=>openUserDetail(idx));")
index = index.replace("item.addEventListener('click',()=>openLogDetail(idx));item.addEventListener('keydown',(event)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openLogDetail(idx);}});", "bindAccessibleActivation(item,()=>openLogDetail(idx));")

write('index.html', index)

# ---------------------------------------------------------------------------
# Final HttpOnly session cutover: runtime-only compatibility marker, no
# persisted auth_token, no legacy bearer exchange.
# ---------------------------------------------------------------------------
bridge = read('src/app/http-only-session-bridge.js')
bridge = bridge.replace('  let exchangePromise = null;\n  let restorePromise = null;', '  let restorePromise = null;\n  let virtualSessionAuthenticated = false;')

old_guard_start = bridge.index('  function installAuthUserStorageGuard()')
old_guard_end = bridge.index('\n\n  installAuthUserStorageGuard();', old_guard_start) + len('\n\n  installAuthUserStorageGuard();')
new_guard = r'''  function installBrowserStorageGuards() {
    if (window.__HADIRLY_BROWSER_STORAGE_GUARD__) return;
    window.__HADIRLY_BROWSER_STORAGE_GUARD__ = true;
    const nativeGetItem = Storage.prototype.getItem;
    const nativeSetItem = Storage.prototype.setItem;
    const nativeRemoveItem = Storage.prototype.removeItem;
    try { nativeRemoveItem.call(localStorage, 'auth_token'); } catch {}
    Storage.prototype.getItem = function guardedStorageGetItem(key) {
      if (this === localStorage && String(key) === 'auth_token' && isCanonicalProduction()) {
        return virtualSessionAuthenticated ? sessionMarker : null;
      }
      return nativeGetItem.call(this, key);
    };
    Storage.prototype.setItem = function guardedStorageSetItem(key, value) {
      if (this === localStorage && String(key) === 'auth_token' && isCanonicalProduction()) {
        virtualSessionAuthenticated = String(value) === sessionMarker;
        try { nativeRemoveItem.call(localStorage, 'auth_token'); } catch {}
        return;
      }
      if (this === localStorage && String(key) === 'auth_user') {
        try { value = JSON.stringify(sanitizePersistentUser(JSON.parse(String(value)))); }
        catch { value = '{}'; }
      }
      return nativeSetItem.call(this, key, value);
    };
    Storage.prototype.removeItem = function guardedStorageRemoveItem(key) {
      if (this === localStorage && String(key) === 'auth_token' && isCanonicalProduction()) {
        virtualSessionAuthenticated = false;
      }
      return nativeRemoveItem.call(this, key);
    };
    try {
      const existing = nativeGetItem.call(localStorage, 'auth_user');
      if (existing) localStorage.setItem('auth_user', existing);
    } catch {}
  }

  installBrowserStorageGuards();'''
bridge = bridge[:old_guard_start] + new_guard + bridge[old_guard_end:]
bridge = replace_function(bridge, 'setMarker', r'''  function setMarker() {
    virtualSessionAuthenticated = true;
    syncRuntimeToken(sessionMarker);
  }''', async_fn=False)

# Remove legacy exchange implementation entirely.
start = bridge.index('  async function exchangeLegacySession()')
end = bridge.index('\n\n  function requestDetails', start)
bridge = bridge[:start] + bridge[end:]
bridge = bridge.replace("    const stored = currentStoredToken();\n    if (stored && stored !== sessionMarker) await exchangeLegacySession();\n", '')
# Remove the bffProxy migration block.
proxy_old = r'''    const stored = currentStoredToken();
    if (stored && stored !== sessionMarker) {
      const migrated = await exchangeLegacySession();
      if (!migrated) {
        return responseWithJson(new Response(null, { status: 401 }), {
          success: false,
          code: 'SESSION_MIGRATION_REQUIRED',
          message: 'Sesi lama tidak dapat diamankan. Silakan login kembali.'
        });
      }
    }
'''
if proxy_old not in bridge:
    raise RuntimeError('legacy proxy migration block missing')
bridge = bridge.replace(proxy_old, '', 1)
bridge = bridge.replace('    exchangeLegacySession,\n', '')
bridge = bridge.replace('    productionRequired: true,\n', '    productionRequired: true,\n    runtimeMarkerOnly: true,\n')
startup_old = r'''  if (isCanonicalProduction()) {
    const stored = currentStoredToken();
    if (stored && stored !== sessionMarker) {
      exchangeLegacySession().then((ok) => { if (ok) restoreCookieSession().catch(() => {}); }).catch(() => {});
    } else {
      restoreCookieSession().catch(() => {});
    }
  }'''
if startup_old not in bridge:
    raise RuntimeError('legacy startup migration block missing')
bridge = bridge.replace(startup_old, "  if (isCanonicalProduction()) restoreCookieSession().catch(() => {});", 1)
if '/api/auth/exchange' in bridge or 'exchangeLegacySession' in bridge:
    raise RuntimeError('legacy exchange still present in browser bridge')
write('src/app/http-only-session-bridge.js', bridge)

# Disable legacy exchange on every Cloudflare entrypoint.
for path in ['wrangler.toml','bff/cloudflare/wrangler.toml','functions/api/[[path]].ts']:
    text=read(path)
    text=text.replace('ALLOW_LEGACY_EXCHANGE = "true"','ALLOW_LEGACY_EXCHANGE = "false"')
    text=text.replace('ALLOW_LEGACY_EXCHANGE: "true"','ALLOW_LEGACY_EXCHANGE: "false"')
    write(path,text)

status=json.loads(read('bff/runtime-status.json'))
status['compatibilityMarkerInLocalStorage']=False
status['compatibilityMarkerRuntimeOnly']=True
status['legacyExchangeEnabled']=False
status['note']='Canonical production uses the HttpOnly cookie BFF. auth_token compatibility is runtime-only and is never persisted to localStorage; legacy bearer exchange is disabled. deploymentVerified remains false until login, refresh/session restore, and logout are externally smoke-tested.'
write('bff/runtime-status.json',json.dumps(status,ensure_ascii=False,indent=2)+'\n')

# PWA release bump so installed clients receive the storage/session and refactor update.
release=read('src/app/release-version.js').replace("26.11.54","26.11.55").replace('absen-sppg-hadirly-v95','absen-sppg-hadirly-v96')
write('src/app/release-version.js',release)
for test in (ROOT/'tests').glob('*.ts'):
    text=test.read_text(encoding='utf-8')
    text=text.replace('26.11.54','26.11.55').replace('absen-sppg-hadirly-v95','absen-sppg-hadirly-v96')
    test.write_text(text,encoding='utf-8')

# Update HttpOnly contract tests for the final runtime-only compatibility phase.
http_test=read('tests/http_only_bff_foundation_test.ts')
http_test=http_test.replace('during non-secret marker compatibility phase','during runtime-only marker compatibility phase')
http_test=http_test.replace('// Transitional compatibility inventory. Raw bearer material is no longer allowed in browser\n// storage on canonical production; these consumers receive only a fixed non-secret marker.', '// Compatibility inventory while legacy call sites still read auth_token. Canonical production\n// virtualizes the fixed marker in memory; no auth_token value is persisted in browser storage.')
http_test=http_test.replace('ALLOW_LEGACY_EXCHANGE: "true"','ALLOW_LEGACY_EXCHANGE: "false"')
http_test=http_test.replace('ALLOW_LEGACY_EXCHANGE = "true"','ALLOW_LEGACY_EXCHANGE = "false"')
http_test=http_test.replace('status.secretStorage !== "http-only-cookie" || status.compatibilityMarkerInLocalStorage !== true','status.secretStorage !== "http-only-cookie" || status.compatibilityMarkerInLocalStorage !== false || status.compatibilityMarkerRuntimeOnly !== true')
http_test=http_test.replace('runtime status must document secret-cookie plus non-secret marker compatibility','runtime status must document HttpOnly secret storage plus runtime-only compatibility')
# Replace the entire canonical cutover test using title boundaries.
old_title='Deno.test("canonical browser cutover is fail-closed and localStorage receives only a non-secret marker"'
start=http_test.index(old_title)
end=http_test.index('\nDeno.test("public registration and password recovery stay available before login"',start)
new_test=r'''Deno.test("canonical browser cutover keeps auth_token runtime-only and disables legacy exchange", async () => {
  const bridge = await read("src/app/http-only-session-bridge.js");
  const bootstrap = await read("src/app/bootstrap.js");
  const status = JSON.parse(await read("bff/runtime-status.json"));
  for (const marker of [
    "const canonicalOrigin = 'https://hadirly.org'",
    "const sessionMarker = '__HADIRLY_HTTP_ONLY_SESSION__'",
    "let virtualSessionAuthenticated = false",
    "function installBrowserStorageGuards()",
    "nativeRemoveItem.call(localStorage, 'auth_token')",
    "return virtualSessionAuthenticated ? sessionMarker : null",
    "runtimeMarkerOnly: true",
    "'/api/auth/login'",
    "'/api/auth/session'",
    "'/api/auth/logout'",
    "`/api/functions/${encodeURIComponent(target)}`",
    "restoreCookieSession",
    "productionRequired: true",
  ]) if (!bridge.includes(marker)) throw new Error(`HttpOnly bridge missing marker: ${marker}`);
  if (bridge.includes("/api/auth/exchange") || bridge.includes("exchangeLegacySession")) {
    throw new Error("browser bridge must not retain legacy bearer exchange after final cutover");
  }
  if (!bootstrap.startsWith("import './http-only-session-bridge.js';")) throw new Error("HttpOnly bridge must initialize first");
  if (status.productionEnabled !== true || status.compatibilityMarkerInLocalStorage !== false || status.compatibilityMarkerRuntimeOnly !== true || status.legacyExchangeEnabled !== false) {
    throw new Error("runtime status does not match final runtime-only marker contract");
  }
});
'''
http_test=http_test[:start]+new_test+http_test[end:]
http_test=http_test.replace('function installAuthUserStorageGuard()','function installBrowserStorageGuards()')
write('tests/http_only_bff_foundation_test.ts',http_test)

session_test=read('tests/session_cookie_regression_test.ts')
session_test=session_test.replace('ALLOW_LEGACY_EXCHANGE = "true"','ALLOW_LEGACY_EXCHANGE = "false"')
if 'runtime-only auth marker never persists' not in session_test:
    session_test += r'''

Deno.test("runtime-only auth marker never persists and legacy exchange is disabled", async () => {
  const bridge = await read("src/app/http-only-session-bridge.js");
  const status = JSON.parse(await read("bff/runtime-status.json"));
  const rootConfig = await read("wrangler.toml");
  const pages = await read("functions/api/[[path]].ts");
  for (const marker of [
    "let virtualSessionAuthenticated = false",
    "nativeRemoveItem.call(localStorage, 'auth_token')",
    "return virtualSessionAuthenticated ? sessionMarker : null",
    "runtimeMarkerOnly: true",
  ]) if (!bridge.includes(marker)) throw new Error(`runtime marker guard missing ${marker}`);
  if (bridge.includes("/api/auth/exchange") || bridge.includes("exchangeLegacySession")) throw new Error("legacy exchange must be absent from browser bridge");
  if (!rootConfig.includes('ALLOW_LEGACY_EXCHANGE = "false"') || !pages.includes('ALLOW_LEGACY_EXCHANGE: "false"')) throw new Error("Cloudflare entrypoints must disable legacy exchange");
  if (status.compatibilityMarkerInLocalStorage !== false || status.compatibilityMarkerRuntimeOnly !== true || status.legacyExchangeEnabled !== false) throw new Error("runtime status must describe final cookie cutover");
});
'''
write('tests/session_cookie_regression_test.ts',session_test)

# Add a code-hygiene regression for the consolidated frontend.
hygiene=read('tests/codebase_hygiene_test.ts')
if 'frontend duplication hotspots use shared helpers' not in hygiene:
    hygiene += r'''

Deno.test("frontend duplication hotspots use shared helpers", async () => {
  const index = await read("index.html");
  for (const marker of [
    "function parseApiError(error,fallback='Terjadi kesalahan')",
    "async function withBusyButton(button,loadingHtml,task)",
    "async function verifyOtpFlow(",
    "async function resendOtpFlow(",
    "function normalizeUserEditorData(user)",
    "async function startFaceCameraSession(",
    "function stopFaceCameraSession(",
    "async function runFaceDetectionLoop(",
    "function bindClicks(ids,handler)",
    "function bindAccessibleActivation(element,handler)",
  ]) if (!index.includes(marker)) throw new Error(`shared frontend helper missing ${marker}`);
  const faceCalls = index.match(/faceapi\.detectSingleFace\(/g)?.length || 0;
  if (faceCalls !== 1) throw new Error(`face detection engine must have one canonical detectSingleFace call, got ${faceCalls}`);
  if ((index.match(/new faceapi\.TinyFaceDetectorOptions\(/g)?.length || 0) !== 1) throw new Error("face detector options must be centralized");
});
'''
write('tests/codebase_hygiene_test.ts',hygiene)

print('frontend finalization patch prepared')
