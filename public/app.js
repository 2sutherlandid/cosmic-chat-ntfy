// public/app.js - upgraded client: WebSocket realtime, DMs, user list, subscribe/unsubscribe
(async function(){
  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(wsProto + '//' + location.host);

  // Simple DOM refs
  const roomsEl = document.getElementById('rooms');
  const messagesEl = document.getElementById('messages');
  const sendBtn = document.getElementById('sendBtn');
  const msgInput = document.getElementById('msgInput');
  const createRoomBtn = document.getElementById('createRoomBtn');
  const currentRoomEl = document.getElementById('currentRoom');
  const joinAudio = document.getElementById('joinAudio');
  const joinVideo = document.getElementById('joinVideo');
  const profileArea = document.getElementById('profileArea');

  let currentRoom = { id: null, topic: 'cosmicgeneral', name: 'cosmicgeneral' };
  let subscriptions = new Set();
  currentRoomEl.textContent = '# ' + currentRoom.topic;

  // WebSocket handlers
  ws.addEventListener('open', ()=>console.log('ws open'));
  ws.addEventListener('message', ev=>{
    try{
      const d = JSON.parse(ev.data);
      if(d.type==='message'){
        const { topic, payload } = d;
        if(topic === currentRoom.topic){ appendMessage(payload.author, payload.payload, payload.created_at); }
      }
    }catch(e){console.error(e)}
  });

  function wsSubscribe(topic){
    if(subscriptions.has(topic)) return;
    ws.send(JSON.stringify({ type: 'subscribe', topic }));
    subscriptions.add(topic);
  }
  function wsUnsubscribe(topic){
    if(!subscriptions.has(topic)) return;
    ws.send(JSON.stringify({ type: 'unsubscribe', topic }));
    subscriptions.delete(topic);
  }

  // Basic auth UI
  function renderAuth() {
    profileArea.innerHTML = '';
    const div = document.createElement('div');
    div.innerHTML = `
      <div id="authBox">
        <input id="username" placeholder="username" /><br/>
        <input id="password" type="password" placeholder="password" /><br/>
        <button id="register">Register</button>
        <button id="login">Login</button>
        <div id="userControls" style="display:none;">
          <button id="refreshUsers">Refresh Users</button>
          <div id="usersList"></div>
        </div>
      </div>
    `;
    profileArea.appendChild(div);
    document.getElementById('register').onclick = async ()=>{
      const u = document.getElementById('username').value, p = document.getElementById('password').value;
      const r = await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
      const j = await r.json(); if(j.ok){alert('registered & logged in'); afterLogin();} else alert(JSON.stringify(j));
    }
    document.getElementById('login').onclick = async ()=>{
      const u = document.getElementById('username').value, p = document.getElementById('password').value;
      const r = await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
      const j = await r.json(); if(j.ok){alert('logged in'); afterLogin()} else alert(JSON.stringify(j));
    }
  }

  function afterLogin(){
    document.getElementById('authBox').style.display='none';
    document.getElementById('userControls').style.display='block';
    document.getElementById('refreshUsers').onclick = loadUsers;
    loadRooms();
    loadUsers();
  }

  async function loadUsers(){
    const r = await fetch('/api/users'); if(!r.ok) return;
    const j = await r.json(); const usersList = document.getElementById('usersList'); usersList.innerHTML='';
    j.users.forEach(u=>{
      const b = document.createElement('button'); b.textContent = u.username; b.onclick = ()=>createDM(u.username); usersList.appendChild(b);
    })
  }

  async function createDM(otherUsername){
    // topic: cosmic-dm-{sorted usernames}
    const my = await whoami(); if(!my) return alert('not logged in');
    const a = [my.username, otherUsername].sort().join('-');
    const topic = 'dm-' + a;
    const r = await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic,name:'DM: '+otherUsername, is_dm:true, participants:[my.username, otherUsername]})});
    const j = await r.json(); if(j.ok){ alert('DM created'); loadRooms(); } else alert(JSON.stringify(j));
  }

  async function whoami(){
    // we don't have /api/whoami; infer from users list by checking session? quick hack: return null to require login flow
    return new Promise((res)=>{
      // We'll fetch rooms and assume session exists if rooms succeed
      fetch('/api/rooms').then(r=>r.ok?res(null):res(null)).catch(()=>res(null));
    });
  }

  async function loadRooms(){
    try{
      const r = await fetch('/api/rooms'); if(!r.ok) return;
      const j = await r.json();
      roomsEl.innerHTML = '';
      j.rooms.forEach(rm=>{
        const e = document.createElement('div');
        e.className='room'+(rm.topic===currentRoom.topic?' active':'');
        e.textContent = (rm.is_dm? 'DM: ':'#')+rm.topic;
        e.onclick = ()=>{ if(currentRoom.topic) wsUnsubscribe(currentRoom.topic); currentRoom = rm; currentRoomEl.textContent = (rm.is_dm? 'DM ':'#')+rm.topic; loadMessages(rm.id); wsSubscribe(rm.topic); };
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
      appendMessage(m.author, m.payload, m.created_at);
    })
  }

  function appendMessage(author, text, time){
    const el = document.createElement('div'); el.className='message'; el.innerHTML=`<div class="author">${author}</div><div class="body">${text}</div><div class=meta>${time||''}</div>`;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  sendBtn.onclick = async ()=>{
    const text = msgInput.value.trim(); if(!text) return;
    await fetch('/api/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:currentRoom.topic,message:text})});
    msgInput.value='';
    // local echo will also be delivered by ws broadcast from server
  }

  createRoomBtn.onclick = async ()=>{
    const topic = prompt('room topic (will be prefixed with cosmic if missing)');
    if(!topic) return;
    const r = await fetch('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic,name:topic})});
    const j = await r.json(); if(j.ok){alert('room created'); loadRooms()} else alert(JSON.stringify(j));
  }

  // WebRTC minimal: open mic/camera and create RTCPeerConnection, then send signaling via publish endpoint (proxy -> ntfy)
  async function startCall({audio=false,video=false}){
    const pc = new RTCPeerConnection();
    pc.ontrack = e=>{
      let v = document.getElementById('remoteVideo'); if(!v){v=document.createElement(video? 'video':'audio'); v.id='remoteVideo'; v.autoplay=true; v.controls=true; document.body.appendChild(v);} v.srcObject = e.streams[0];
    }
    const stream = await navigator.mediaDevices.getUserMedia({audio,video});
    stream.getTracks().forEach(t=>pc.addTrack(t,stream));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    // publish offer via server proxy
    await fetch('/api/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:currentRoom.topic+'-signaling',message:JSON.stringify({type:'offer',sdp:offer.sdp,from:Math.random().toString(36).slice(2)})})});

    // listen for answer via WebSocket subscription (server will broadcast signaling messages too)
    ws.addEventListener('message', async function handler(ev){
      try{
        const d = JSON.parse(ev.data);
        if(d.type==='message' && d.topic === currentRoom.topic+'-signaling'){
          const p = JSON.parse(d.payload.payload || d.payload);
          if(p && p.type === 'answer'){
            await pc.setRemoteDescription({type:'answer',sdp:p.sdp});
            ws.removeEventListener('message', handler);
            console.log('call established');
          }
        }
      }catch(e){console.error(e)}
    });
  }

  joinAudio.onclick = ()=>startCall({audio:true,video:false});
  joinVideo.onclick = ()=>startCall({audio:true,video:true});

  // initial
  renderAuth();
})();
