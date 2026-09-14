// public/app.js - client side logic (basic)
(async function(){
  const NTFY_HOST = (window.NTFY_HOST = '/') // we'll proxy publish to server by default
  // Simple DOM refs
  const roomsEl = document.getElementById('rooms');
  const messagesEl = document.getElementById('messages');
  const sendBtn = document.getElementById('sendBtn');
  const msgInput = document.getElementById('msgInput');
  const createRoomBtn = document.getElementById('createRoomBtn');
  const currentRoomEl = document.getElementById('currentRoom');
  const joinAudio = document.getElementById('joinAudio');
  const joinVideo = document.getElementById('joinVideo');

  let currentRoom = { id: null, topic: 'cosmicgeneral', name: 'cosmicgeneral' };
  currentRoomEl.textContent = '# ' + currentRoom.topic;

  // Basic auth UI
  const profileArea = document.getElementById('profileArea');
  function renderAuth() {
    profileArea.innerHTML = '';
    const div = document.createElement('div');
    div.innerHTML = `
      <div id="authBox">
        <input id="username" placeholder="username" /><br/>
        <input id="password" type="password" placeholder="password" /><br/>
        <button id="register">Register</button>
        <button id="login">Login</button>
      </div>
    `;
    profileArea.appendChild(div);
    document.getElementById('register').onclick = async ()=>{
      const u = document.getElementById('username').value, p = document.getElementById('password').value;
      const r = await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
      const j = await r.json(); if(j.ok){alert('registered & logged in'); loadRooms()} else alert(JSON.stringify(j));
    }
    document.getElementById('login').onclick = async ()=>{
      const u = document.getElementById('username').value, p = document.getElementById('password').value;
      const r = await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
      const j = await r.json(); if(j.ok){alert('logged in'); loadRooms()} else alert(JSON.stringify(j));
    }
  }
  renderAuth();

  async function loadRooms(){
    try{
      const r = await fetch('/api/rooms');
      if(!r.ok) return;
      const j = await r.json();
      roomsEl.innerHTML = '';
      j.rooms.forEach(rm=>{
        const e = document.createElement('div');
        e.className='room'+(rm.topic===currentRoom.topic?' active':'');
        e.textContent = '#'+rm.topic;
        e.onclick = ()=>{currentRoom = rm; currentRoomEl.textContent = '# '+rm.topic; loadMessages(rm.id)};
        roomsEl.appendChild(e);
      })
    }catch(e){console.error(e)}
  }
  async function loadMessages(roomId){
    if(!roomId) return;
    const r = await fetch(`/api/rooms/${roomId}/messages`);
    if(!r.ok) return;
    const j = await r.json();
    messagesEl.innerHTML='';
    j.messages.forEach(m=>{
      const el = document.createElement('div'); el.className='message'; el.innerHTML=`<div class="author">${m.author}</div><div class="body">${m.payload}</div><div class=meta>${m.created_at}</div>`;
      messagesEl.appendChild(el);
    })
  }

  sendBtn.onclick = async ()=>{
    const text = msgInput.value.trim(); if(!text) return;
    // publish via server proxy
    await fetch('/api/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:currentRoom.topic,message:text})});
    msgInput.value='';
    // we rely on ntfy subscriptions (not implemented in this sample) — fallback: append locally
    const el = document.createElement('div'); el.className='message'; el.innerHTML=`<div class="author">you</div><div class="body">${text}</div>`;
    messagesEl.appendChild(el);
  }

  createRoomBtn.onclick = async ()=>{
    const topic = prompt('room topic (will be prefixed with cosmic if missing)');
    if(!topic) return;
    const r = await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic,name:topic})});
    const j = await r.json(); if(j.ok){alert('room created'); loadRooms()} else alert(JSON.stringify(j));
  }

  // WebRTC minimal: open mic/camera and create RTCPeerConnection, then send signaling via publish endpoint (proxy via server -> ntfy)
  async function startCall({audio=false,video=false}){
    const pc = new RTCPeerConnection();
    pc.ontrack = e=>{
      console.log('remote track',e);
      // show remote stream
      let v = document.getElementById('remoteVideo'); if(!v){v=document.createElement(video? 'video':'audio'); v.id='remoteVideo'; v.autoplay=true; v.controls=true; document.body.appendChild(v);} v.srcObject = e.streams[0];
    }
    const stream = await navigator.mediaDevices.getUserMedia({audio,video});
    stream.getTracks().forEach(t=>pc.addTrack(t,stream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    // publish offer via ntfy topic
    await fetch('/api/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:currentRoom.topic+'-signaling',message:JSON.stringify({type:'offer',sdp:offer.sdp,from:Math.random().toString(36).slice(2)})})});

    // Listen for answers via simple polling to server message history endpoint (for demo)
    const poll = setInterval(async ()=>{
      const r = await fetch(`/api/rooms/${currentRoom.id}/messages`);
      const j = await r.json();
      for(const m of j.messages){
        try{const p=JSON.parse(m.payload); if(p.type==='answer'){ await pc.setRemoteDescription({type:'answer',sdp:p.sdp}); clearInterval(poll); console.log('call established'); }}catch(e){}
      }
    },2000);
  }

  joinAudio.onclick = ()=>startCall({audio:true,video:false});
  joinVideo.onclick = ()=>startCall({audio:true,video:true});

  // initial
  loadRooms();
})();
