import { useState, useEffect, useRef } from "react";
import { supabase, BUCKETS, uploadToBucket } from "./lib/supabaseClient";

/* ══════════════════════════════════════════════════════════
   CoupleSpace Final — Complete App
   • Couple Savings Pool (4 rules)
   • Circle/Ajo Cooperative (5 rules)
   • 2% protocol fee on all payouts
   • Simple, straightforward UI
══════════════════════════════════════════════════════════ */

const FontLink = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400&family=DM+Sans:wght@300;400;500;600;700&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
    body { background:#000000; }
    @keyframes floatUp   { 0%{opacity:0;transform:translateY(18px)} 100%{opacity:1;transform:translateY(0)} }
    @keyframes fadeIn    { from{opacity:0} to{opacity:1} }
    @keyframes pulseGlow { 0%,100%{box-shadow:0 0 28px rgba(29,155,240,0.35)} 50%{box-shadow:0 0 56px rgba(29,155,240,0.65)} }
    @keyframes heartbeat { 0%,100%{transform:scale(1)} 14%{transform:scale(1.18)} 28%{transform:scale(1)} 42%{transform:scale(1.1)} 56%{transform:scale(1)} }
    @keyframes orbit     { from{transform:rotate(0deg) translateX(54px) rotate(0deg)} to{transform:rotate(360deg) translateX(54px) rotate(-360deg)} }
    @keyframes blink     { 0%,100%{opacity:0.3} 50%{opacity:1} }
    @keyframes ripple    { 0%{transform:scale(0.95);opacity:0.7} 100%{transform:scale(1.6);opacity:0}} }
    @keyframes starTwinkle { 0%,100%{opacity:0.15;transform:scale(1)} 50%{opacity:0.9;transform:scale(1.4)} }
    @keyframes coopPulse { 0%,100%{box-shadow:0 0 24px rgba(16,185,129,0.25)} 50%{box-shadow:0 0 48px rgba(16,185,129,0.55)} }
    .f1 { animation: floatUp 0.55s ease forwards; }
    .f2 { animation: floatUp 0.55s 0.1s ease forwards; opacity:0; }
    .f3 { animation: floatUp 0.55s 0.2s ease forwards; opacity:0; }
    .f4 { animation: floatUp 0.55s 0.3s ease forwards; opacity:0; }
    .f5 { animation: floatUp 0.55s 0.4s ease forwards; opacity:0; }
    .f6 { animation: floatUp 0.55s 0.5s ease forwards; opacity:0; }
    input::placeholder { color: rgba(29,155,240,0.35); }
    input:focus { outline:none; border-color: rgba(29,155,240,0.6) !important; }
    textarea::placeholder { color: rgba(29,155,240,0.35); }
    textarea:focus { outline:none; border-color: rgba(29,155,240,0.6) !important; }
    ::-webkit-scrollbar { width:0; }
  `}</style>
);

const SCREENS = {
  SPLASH:"splash", ZKLOGIN:"zklogin", LOGIN:"login", SETUP:"setup", HANDSHAKE:"handshake",
  WALLET:"wallet",
  HOME:"home", CHAT:"chat", MEMORIES:"memories", SAVINGS:"savings", GOAL_CREATE:"goal_create",
  PERSONAL:"personal", PERSONAL_CREATE:"personal_create",
  CIRCLE_ENTRY:"circle_entry",
  CIRCLE_LOGIN:"circle_login", CIRCLE_REGISTER:"circle_register", CIRCLE_PORTAL:"circle_portal", CIRCLE_CHAT:"circle_chat",
};

/* ══════════════════════════════════════════════════════════
   zkLogin / Enoki helpers
   ─────────────────────────────────────────────────────────
   In production, replace ENOKI_API_KEY with your real key
   from https://portal.enoki.mystenlabs.com
   and set your Google OAuth Client ID below.
   The deriveSuiAddress utility is a lightweight reimplementation
   of the on-chain logic so we don't need the full SDK at runtime.
══════════════════════════════════════════════════════════ */
const ENOKI_API_KEY   = "enoki_public_81f69efa32009bbcc144f8f4a0a02219";
const GOOGLE_CLIENT_ID = "822140699935-sqni61tg3nlbvp4sdvaq5jpmmq3k5vav.apps.googleusercontent.com";
const ENOKI_BASE      = "https://api.enoki.mystenlabs.com/v1";

// Deterministically shorten an address for display
const shortAddr = (addr) => addr ? `${addr.slice(0,6)}…${addr.slice(-4)}` : "";

// Normalize a wallet address for storage/comparison: trim whitespace and
// lowercase. Sui addresses are hex strings, so case differences should
// never represent different addresses — but inconsistent casing would
// otherwise cause vault lookups to silently miss/duplicate.
const normalizeAddress = (addr) => (addr || "").trim().toLowerCase();

// Order a pair of addresses canonically (alphabetical) so the same couple
// always maps to one `vaults` row regardless of who set up the vault.
// Returns [partner_a, partner_b] both normalized.
const canonicalPair = (addrA, addrB) => {
  const a = normalizeAddress(addrA);
  const b = normalizeAddress(addrB);
  return a <= b ? [a, b] : [b, a];
};

// Copy to clipboard helper
const copyToClipboard = async (text) => {
  try { await navigator.clipboard.writeText(text); return true; }
  catch { return false; }
};

// Generate a random nonce for the OAuth flow (stored in sessionStorage)
const generateNonce = () => {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => b.toString(16).padStart(2,"0")).join("");
};

// Build the Google OAuth URL pointing to Enoki's zkLogin endpoint
const buildGoogleOAuthUrl = (nonce) => {
  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  window.location.origin + window.location.pathname,
    response_type: "id_token",
    scope:         "openid email profile",
    nonce,
    prompt:        "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
};

// Parse id_token from URL hash fragment (after OAuth redirect)
const parseIdTokenFromHash = () => {
  const hash = window.location.hash.slice(1);
  const params = new URLSearchParams(hash);
  return params.get("id_token") || null;
};

// Decode JWT payload without verification (verification happens on Enoki's server)
const decodeJwtPayload = (jwt) => {
  try {
    const base64 = jwt.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
    return JSON.parse(atob(base64));
  } catch { return null; }
};

// Call Enoki to derive the Sui zkLogin address for a given JWT + salt
const fetchZkLoginAddress = async (jwt, salt) => {
  const res = await fetch(`${ENOKI_BASE}/zklogin`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "zklogin-jwt":   jwt,
      "Authorization": `Bearer ${ENOKI_API_KEY}`,
    },
    body: JSON.stringify({ jwt, salt }),
  });
  if (!res.ok) throw new Error(`Enoki error ${res.status}`);
  const data = await res.json();
  return data.data?.address ?? null;
};

// Fetch or create a per-user salt from Enoki (tied to the sub claim in the JWT)
const fetchOrCreateSalt = async (jwt) => {
  const res = await fetch(`${ENOKI_BASE}/zklogin/salt`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${ENOKI_API_KEY}`,
      "zklogin-jwt":   jwt,
    },
  });
  if (!res.ok) throw new Error(`Salt error ${res.status}`);
  const data = await res.json();
  return data.data?.salt ?? null;
};

const Stars = () => {
  const stars = Array.from({length:28},(_,i)=>({
    x:Math.random()*100, y:Math.random()*100, s:Math.random()*2+1, d:Math.random()*4+2, delay:Math.random()*5,
  }));
  return (
    <div style={{position:"absolute",inset:0,pointerEvents:"none",overflow:"hidden",zIndex:0}}>
      {stars.map((st,i)=>(
        <div key={i} style={{position:"absolute",left:`${st.x}%`,top:`${st.y}%`,width:st.s,height:st.s,borderRadius:"50%",background:"#fff",animation:`starTwinkle ${st.d}s ${st.delay}s ease-in-out infinite`}}/>
      ))}
    </div>
  );
};

const Petals = () => {
  const petals = ["✿","❀","✾","❁","✽"];
  return (
    <div style={{position:"absolute",inset:0,pointerEvents:"none",overflow:"hidden",zIndex:0}}>
      {Array.from({length:7},(_,i)=>(
        <div key={i} style={{position:"absolute",left:`${10+i*13}%`,top:`${-5+Math.random()*20}%`,fontSize:10+i*2,color:"rgba(29,155,240,0.18)",animation:`floatUp ${4+i}s ${i*0.7}s ease-in-out infinite alternate`}}>{petals[i%petals.length]}</div>
      ))}
    </div>
  );
};

const Avatar = ({name, size=46, gradient="linear-gradient(135deg,#1D9BF0,#5C1A6E)", glow="rgba(29,155,240,0.5)"}) => (
  <div style={{width:size,height:size,borderRadius:"50%",background:gradient,display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*0.37,fontWeight:700,color:"#fff",fontFamily:"'DM Sans',sans-serif",border:"2px solid rgba(0,0,0,0.8)",boxShadow:`0 0 ${size*0.4}px ${glow}`,flexShrink:0}}>{name?name[0].toUpperCase():"?"}</div>
);

const S = {
  root:{background:"#000000",minHeight:"100vh",position:"relative",overflowX:"hidden",maxWidth:430,margin:"0 auto"},
  meshBg:{position:"absolute",inset:0,pointerEvents:"none",zIndex:0},
  card:{background:"rgba(0,0,0,0.85)",borderRadius:22,padding:"22px 18px",border:"1px solid rgba(29,155,240,0.12)",boxShadow:"0 4px 28px rgba(0,0,0,0.4)",backdropFilter:"blur(10px)"},
  cardEyebrow:{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.5)",fontSize:11,fontWeight:600,letterSpacing:1.2,textTransform:"uppercase",marginBottom:14},
  authBtn:{width:"100%",padding:"14px 16px",borderRadius:14,background:"rgba(29,155,240,0.12)",border:"1px solid rgba(29,155,240,0.15)",color:"#FFFFFF",fontSize:15,display:"flex",alignItems:"center",gap:12,cursor:"pointer"},
  authBtnIcon:{width:28,height:28,borderRadius:"50%",background:"linear-gradient(135deg,#1D9BF0,#1A8CD8)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0},
  backBtn:{background:"none",border:"none",fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.55)",fontSize:13,cursor:"pointer",padding:"6px 0",letterSpacing:0.3},
  input:{width:"100%",padding:"14px 16px",borderRadius:14,background:"rgba(29,155,240,0.06)",border:"1px solid rgba(29,155,240,0.18)",color:"#FFFFFF",fontSize:14,fontFamily:"'DM Sans',sans-serif",fontWeight:300},
  primaryBtn:{width:"100%",padding:"16px",borderRadius:16,background:"linear-gradient(135deg,#1D9BF0,#1A8CD8)",border:"none",color:"#fff",fontSize:15,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",boxShadow:"0 6px 24px rgba(29,155,240,0.45)",letterSpacing:0.3},
  sectionLabel:{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.45)",fontSize:11,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",marginBottom:12},
  cAvatar:{width:46,height:46,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,fontWeight:700,color:"#fff",fontFamily:"'DM Sans',sans-serif",border:"2px solid rgba(0,0,0,0.8)"},
  quoteCard:{background:"rgba(29,155,240,0.07)",borderRadius:18,padding:"18px",border:"1px solid rgba(29,155,240,0.1)"},
};

/* ── Couple BottomNav (purple) ── */
const BottomNav = ({activeTab, setActiveTab, goTo}) => {
  const tabs = [
    {icon:"💳",label:"Wallet",id:"wallet",screen:SCREENS.WALLET},
    {icon:"🏠",label:"Home",id:"home",screen:SCREENS.HOME},
    {icon:"💬",label:"Chat",id:"chat",screen:SCREENS.CHAT},
    {icon:"🗂️",label:"Memories",id:"memories",screen:SCREENS.MEMORIES},
    {icon:"💰",label:"Savings",id:"savings",screen:SCREENS.SAVINGS},
  ];
  return (
    <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:"rgba(0,0,0,0.93)",backdropFilter:"blur(24px)",borderTop:"1px solid rgba(29,155,240,0.1)",display:"flex",justifyContent:"space-around",padding:"10px 0 22px",zIndex:100}}>
      {tabs.map(tab=>(
        <button key={tab.id} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,background:"none",border:"none",cursor:"pointer",padding:"4px 10px"}} onClick={()=>{setActiveTab(tab.id);goTo(tab.screen);}}>
          <span style={{fontSize:19}}>{tab.icon}</span>
          <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:9,fontWeight:500,color:activeTab===tab.id?"#1D9BF0":"rgba(29,155,240,0.3)",transition:"color 0.2s"}}>{tab.label}</span>
          {activeTab===tab.id&&<div style={{width:18,height:2,borderRadius:2,background:"linear-gradient(90deg,#1D9BF0,#1D9BF0)",marginTop:-2}}/>}
        </button>
      ))}
    </div>
  );
};

/* ── Circle BottomNav (green, completely separate) ── */
const CircleNav = ({circleTab, setCircleTab, goTo}) => {
  const tabs = [
    {icon:"📊",label:"Pool",id:"pool"},
    {icon:"👥",label:"Members",id:"members"},
    {icon:"💬",label:"Chat",id:"chat",screen:SCREENS.CIRCLE_CHAT},
    {icon:"📜",label:"Rules",id:"rules"},
  ];
  return (
    <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:"rgba(4,15,10,0.95)",backdropFilter:"blur(24px)",borderTop:"1px solid rgba(16,185,129,0.15)",display:"flex",justifyContent:"space-around",padding:"10px 0 22px",zIndex:100}}>
      {tabs.map(tab=>(
        <button key={tab.id} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4,background:"none",border:"none",cursor:"pointer",padding:"4px 10px"}}
          onClick={()=>{ if(tab.screen) goTo(tab.screen); else setCircleTab(tab.id); }}>
          <span style={{fontSize:19}}>{tab.icon}</span>
          <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:9,fontWeight:500,transition:"color 0.2s",
            color:circleTab===tab.id?"#10B981":"rgba(16,185,129,0.3)"}}>{tab.label}</span>
          {circleTab===tab.id&&<div style={{width:18,height:2,borderRadius:2,background:"linear-gradient(90deg,#047857,#10B981)",marginTop:-2}}/>}
        </button>
      ))}
    </div>
  );
};

export default function CoupleSpace() {
  const [screen, setScreen] = useState(SCREENS.SPLASH);
  const [splashStage, setSplashStage] = useState(0);
  const [activeTab, setActiveTab] = useState("home");
  const [appMode, setAppMode] = useState("couple"); // "couple" | "circle"
  const [myName, setMyName] = useState("");
  const [partnerName, setPartnerName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [addressInput, setAddressInput] = useState("");
  const [partnerAddress, setPartnerAddress] = useState("");

  // ── zkLogin state ──
  const [zkUser, setZkUser]       = useState(null);   // { address, email, name, picture, jwt, salt }
  const [zkLoading, setZkLoading] = useState(false);
  const [zkError, setZkError]     = useState("");
  const [copied, setCopied]       = useState(false);

  // Derived: the real on-chain address (zkLogin or fallback placeholder)
  const myAddress = zkUser?.address ?? "0x0000…0000";

  // ── Wallet state ──
  const [walletBalances, setWalletBalances] = useState({sui:12.45, usdc:340.00});
  const [walletTxns, setWalletTxns] = useState([
    {id:1,type:"received",token:"SUI", amount:10.00,  from:"0x4d7e…8f0a", date:"Jun 10, 2024",  note:"From Kofi"},
    {id:2,type:"sent",    token:"USDC",amount:50.00,  to:"0x9f3a…2b1c",   date:"Jun 8, 2024",   note:"Savings contribution"},
    {id:3,type:"received",token:"USDC",amount:200.00, from:"0x1a2b…6c9e", date:"Jun 5, 2024",   note:"Circle payout"},
    {id:4,type:"sent",    token:"SUI", amount:2.00,   to:"0x7f8c…3a4b",   date:"Jun 1, 2024",   note:"Gas"},
  ]);
  const [showSendModal, setShowSendModal]       = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);
  const [sendToken, setSendToken]               = useState("SUI");
  const [sendAmount, setSendAmount]             = useState("");
  const [sendAddress, setSendAddress]           = useState("");
  const [sendNote, setSendNote]                 = useState("");
  const [walletCopied, setWalletCopied]         = useState(false);

  // ── Vault identity (Supabase) ──
  // `vaultId` identifies the row in the `vaults` table for this couple,
  // looked up/created from (myAddress, partnerAddress) once both are known.
  // Messages and Memories are scoped to this id.
  // TODO (next step): once myAddress + partnerAddress are set, look up or
  // create the vault row, store its id here, then load message/memory
  // history from Supabase instead of the seed data below.
  const [vaultId, setVaultId] = useState(null);

  // Chat state
  const [messages, setMessages] = useState([
    {id:1,from:"her",type:"text",text:"Good morning love ☀️",time:"8:02 AM"},
    {id:2,from:"me",type:"text",text:"Morning beautiful 🌹",time:"8:04 AM"},
    {id:3,from:"her",type:"text",text:"Did you check the savings pool?",time:"8:10 AM"},
    {id:4,from:"me",type:"text",text:"Just did! We're at 68% now 🎯",time:"8:11 AM"},
  ]);
  const [chatInput, setChatInput] = useState("");
  const chatEndRef = useRef(null);

  useEffect(()=>{
    return ()=>{
      clearInterval(recordingTimerRef.current);
      recordingStreamRef.current?.getTracks().forEach(t=>t.stop());
    };
  },[]);

  // ── Chat media: voice notes, files, video ──
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [recording, setRecording] = useState(null); // null | {type:"voice"|"video", seconds}
  const fileInputRef   = useRef(null);
  const videoInputRef  = useRef(null);
  const imageInputRef  = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recordingStreamRef = useRef(null);
  const recordingTimerRef = useRef(null);
  const recordingSecondsRef = useRef(0);
  const [mediaError, setMediaError] = useState("");


  // Memories
  const [memories, setMemories] = useState([
    {id:1,label:"First Date 🌹",date:"Jan 14, 2024",type:"image",icon:"🖼️",color:"#7C3AED"},
    {id:2,label:"Lease Agreement",date:"Mar 2, 2024",type:"pdf",icon:"📄",color:"#0EA5E9"},
    {id:3,label:"Anniversary Video",date:"Jun 18, 2024",type:"video",icon:"🎥",color:"#EC4899"},
  ]);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploading, setUploading] = useState(false);
  const memoryFileInputRef = useRef(null);

  // Savings Pool - Multiple Goals
  const [goals, setGoals] = useState([
    {id:1,label:"Apartment Fund 🏠",token:"USDC",target:5000,saved:3400,myContrib:1800,partnerContrib:1600,myMonthlyCommit:300,partnerMonthlyCommit:300,myMisses:0,partnerMisses:0,releaseType:"percent",releaseValue:80,destinationWallet:"0x9f3a…2b1c",status:"active",createdDate:"2024-01-15"},
    {id:2,label:"Vacation Fund 🌴",token:"USDC",target:2000,saved:800,myContrib:450,partnerContrib:350,myMonthlyCommit:150,partnerMonthlyCommit:150,myMisses:0,partnerMisses:0,releaseType:"date",releaseValue:"2024-12-25",destinationWallet:"0x4a2e…8c9f",status:"active",createdDate:"2024-03-01"},
  ]);
  const [activeGoal, setActiveGoal] = useState(goals[0]);
  const [showContributeModal, setShowContributeModal] = useState(false);
  const [contribAmount, setContribAmount] = useState("");
  const [showCreateGoalModal, setShowCreateGoalModal] = useState(false);
  const [newGoal, setNewGoal] = useState({label:"",token:"USDC",target:"",releaseType:"percent",releaseValue:"80"});

  // Circle state
  const [circles, setCircles] = useState([
    {id:1,name:"Sunrise Ajo",circleId:"CIRC-0x9f3a",size:6,contribution:100,token:"USDC",gracePeriod:3,createdDate:"2024-01-01",status:"active",members:[
      {addr:"0x9f3a…2b1c",name:"Amara K.",slot:1,paid:true,misses:0,received:false,stake:100},
      {addr:"0x4d7e…8f0a",name:"Kofi M.",slot:2,paid:true,misses:0,received:false,stake:100},
      {addr:"0x1a2b…6c9e",name:"Priya S.",slot:3,paid:false,misses:1,received:false,stake:100},
      {addr:"0x7f8c…3a4b",name:"Diego R.",slot:4,paid:true,misses:0,received:false,stake:100},
      {addr:"0x2e4f…9d5a",name:"Yuki T.",slot:5,paid:false,misses:2,received:false,stake:0,ejected:true},
      {addr:"0x5b6c…1e2f",name:"Fatima L.",slot:6,paid:true,misses:0,received:false,stake:100},
    ],currentRound:1,currentSlot:1,monthlyPool:600}
  ]);
  const [activeCircle, setActiveCircle] = useState(circles[0]);
  const [circleTab, setCircleTab] = useState("pool");
  const [circleChat, setCircleChat] = useState([
    {id:1,from:"Amara K.",color:"#1D9BF0",text:"Circle starts next week! Please fund your wallets 🙏",time:"10:00 AM"},
    {id:2,from:"Kofi M.",color:"#1D9BF0",text:"Confirmed. When does the random draw happen?",time:"10:05 AM"},
    {id:3,from:"Priya S.",color:"#0EA5E9",text:"The contract does it when Admin calls start 🔗",time:"10:08 AM"},
  ]);
  const [circleChatInput, setCircleChatInput] = useState("");
  const circleChatEndRef = useRef(null);
  const [showCircleCreateModal, setShowCircleCreateModal] = useState(false);
  // appMode ("couple"|"circle") handles section separation — inCoupleSection removed
  const [newCircle, setNewCircle] = useState({name:"",size:"6",contribution:"100",token:"USDC",gracePeriod:"3"});

  // ── Personal Savings (fully private — partner cannot see) ──
  const [personalGoals, setPersonalGoals] = useState([
    {
      id:1, label:"Emergency Fund 🛡️", token:"USDC",
      target:1000, saved:420,
      triggerType:"amount",
      triggerValue:"1000",
      destinationWallet:"0x7a2d…f9c3",
      status:"active",
      createdDate:"2024-04-01",
      contributions:[
        {month:"Apr",amount:200},{month:"May",amount:120},{month:"Jun",amount:100},
      ],
    },
    {
      id:2, label:"MacBook Pro 💻", token:"USDC",
      target:2500, saved:750,
      triggerType:"date",
      triggerValue:"2024-12-01",
      destinationWallet:"0x7a2d…f9c3",
      status:"active",
      createdDate:"2024-05-10",
      contributions:[
        {month:"May",amount:500},{month:"Jun",amount:250},
      ],
    },
  ]);
  const [activePersonalGoal, setActivePersonalGoal] = useState(null);
  const [showPersonalContrib, setShowPersonalContrib] = useState(false);
  const [personalContribAmount, setPersonalContribAmount] = useState("");
  const [newPersonalGoal, setNewPersonalGoal] = useState({
    label:"", token:"USDC", target:"",
    triggerType:"amount", triggerValue:"", destinationWallet:"",
  });

  /* ── Handle OAuth redirect (Enoki/Google callback) ── */
  useEffect(()=>{
    const idToken = parseIdTokenFromHash();
    if (!idToken) return; // not an OAuth redirect, normal app load

    // Clear the hash so it doesn't pollute the URL
    window.history.replaceState(null, "", window.location.pathname);

    const storedNonce = sessionStorage.getItem("cs_oauth_nonce");
    const payload = decodeJwtPayload(idToken);
    if (!payload) { setZkError("Invalid sign-in response. Please try again."); return; }

    setZkLoading(true);
    setScreen(SCREENS.ZKLOGIN);

    (async () => {
      try {
        const salt    = await fetchOrCreateSalt(idToken);
        const address = await fetchZkLoginAddress(idToken, salt);
        const user    = {
          address,
          salt,
          jwt:     idToken,
          email:   payload.email   ?? "",
          name:    payload.name    ?? "",
          picture: payload.picture ?? "",
        };
        setZkUser(user);
        sessionStorage.setItem("cs_user", JSON.stringify(user));
        // If they already set a name, skip SETUP; go straight to LOGIN (space picker)
        const savedName = localStorage.getItem("cs_myName");
        if (savedName) {
          setMyName(savedName);
          setNameInput(savedName);
          goTo(SCREENS.LOGIN);
        } else {
          goTo(SCREENS.SETUP);
        }
      } catch(e) {
        setZkError("Could not verify sign-in. Please try again.");
        setZkLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Restore session from sessionStorage on app load ── */
  useEffect(()=>{
    const saved = sessionStorage.getItem("cs_user");
    const savedName = localStorage.getItem("cs_myName");
    if (saved && !zkUser) {
      try {
        const user = JSON.parse(saved);
        setZkUser(user);
        if (savedName) { setMyName(savedName); setNameInput(savedName); }
      } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Splash */
  useEffect(()=>{
    // Don't run splash if we're already handling an OAuth redirect
    if (parseIdTokenFromHash()) return;
    if(screen===SCREENS.SPLASH){
      const t1=setTimeout(()=>setSplashStage(1),600);
      const t2=setTimeout(()=>setSplashStage(2),1400);
      const t3=setTimeout(()=>setScreen(SCREENS.ZKLOGIN),3000);
      return()=>{clearTimeout(t1);clearTimeout(t2);clearTimeout(t3);}
    }
  },[screen]);

  useEffect(()=>{ chatEndRef.current?.scrollIntoView({behavior:"smooth"}); },[messages]);
  useEffect(()=>{ circleChatEndRef.current?.scrollIntoView({behavior:"smooth"}); },[circleChat]);

  const goTo=(s)=>{ 
    setScreen(s);
    if(s===SCREENS.HOME)          { setActiveTab("home");     setAppMode("couple"); }
    if(s===SCREENS.CHAT)          { setActiveTab("chat");     setAppMode("couple"); }
    if(s===SCREENS.MEMORIES)      { setActiveTab("memories"); setAppMode("couple"); }
    if(s===SCREENS.SAVINGS)       { setActiveTab("savings");  setAppMode("couple"); }
    if(s===SCREENS.PERSONAL)      { setActiveTab("personal"); setAppMode("couple"); }
    if(s===SCREENS.PERSONAL_CREATE){ setActiveTab("personal"); setAppMode("couple"); }
    if(s===SCREENS.WALLET)         { setAppMode("couple"); setActiveTab("wallet"); }
    if(s===SCREENS.CIRCLE_ENTRY)  { setAppMode("circle"); }
    if(s===SCREENS.CIRCLE_LOGIN)  { setAppMode("circle"); }
    if(s===SCREENS.CIRCLE_PORTAL) { setAppMode("circle"); }
    if(s===SCREENS.CIRCLE_CHAT)   { setAppMode("circle"); }
  };

  const signOut = () => {
    sessionStorage.removeItem("cs_user");
    localStorage.removeItem("cs_myName");
    setZkUser(null);
    setMyName("");
    setNameInput("");
    setPartnerAddress("");
    setZkError("");
    goTo(SCREENS.ZKLOGIN);
  };

  const handleGoogleSignIn = () => {
    setZkError("");
    const nonce = generateNonce();
    sessionStorage.setItem("cs_oauth_nonce", nonce);
    window.location.href = buildGoogleOAuthUrl(nonce);
  };

  /* ── Wallet handlers ── */
  const handleSend = () => {
    const amt = parseFloat(sendAmount);
    if (!amt || amt <= 0 || !sendAddress.trim()) return;
    if (sendToken === "SUI"  && amt > walletBalances.sui)  return;
    if (sendToken === "USDC" && amt > walletBalances.usdc) return;
    setWalletBalances(prev => ({
      ...prev,
      sui:  sendToken==="SUI"  ? +(prev.sui  - amt).toFixed(4) : prev.sui,
      usdc: sendToken==="USDC" ? +(prev.usdc - amt).toFixed(2) : prev.usdc,
    }));
    const now = new Date().toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"});
    setWalletTxns(prev => [{
      id: prev.length+1, type:"sent", token:sendToken, amount:amt,
      to: sendAddress, date:now, note:sendNote||"",
    }, ...prev]);
    setSendAmount(""); setSendAddress(""); setSendNote(""); setShowSendModal(false);
  };

  const copyWalletAddress = async () => {
    const ok = await copyToClipboard(myAddress);
    if (ok) { setWalletCopied(true); setTimeout(()=>setWalletCopied(false), 2000); }
  };

  /* Chat */
  const nowTime = () => new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});

  const formatBytes=(bytes)=>{
    if(bytes<1024) return bytes+" B";
    if(bytes<1024*1024) return (bytes/1024).toFixed(1)+" KB";
    return (bytes/(1024*1024)).toFixed(1)+" MB";
  };

  const formatDuration=(sec)=>{
    const m=Math.floor(sec/60), s=Math.floor(sec%60);
    return `${m}:${s.toString().padStart(2,"0")}`;
  };

  // Map a DB row (from `messages` table) to the shape the chat UI expects
  const rowToMessage = (row) => ({
    id: row.id,
    from: row.sender === normalizeAddress(myAddress) ? "me" : "her",
    type: row.type,
    text: row.text,
    fileUrl: row.media_url,
    videoUrl: row.media_url,
    audioUrl: row.media_url,
    imageUrl: row.media_url,
    fileName: row.file_name,
    fileSize: row.file_size,
    duration: row.duration,
    time: new Date(row.created_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}),
  });

  /* ── Look up or create the vault row for (myAddress, partnerAddress) ──
     Addresses are normalized and ordered canonically so the same couple
     always maps to exactly one row, regardless of who set up the vault
     or how addresses were cased/whitespaced when entered. ── */
  const getOrCreateVault = async () => {
    if (!myAddress || !partnerAddress || myAddress.startsWith("0x0000")) return null;
    const [partnerA, partnerB] = canonicalPair(myAddress, partnerAddress);
    try {
      const { data: existing, error: findErr } = await supabase
        .from("vaults")
        .select("*")
        .eq("partner_a", partnerA)
        .eq("partner_b", partnerB)
        .maybeSingle();
      if (findErr) throw findErr;
      if (existing) return existing.id;

      const { data: created, error: createErr } = await supabase
        .from("vaults")
        .insert({
          partner_a: partnerA,
          partner_b: partnerB,
          partner_a_name: myName || null,
          partner_b_name: partnerName || null,
        })
        .select()
        .single();
      if (createErr) throw createErr;
      return created.id;
    } catch (err) {
      console.warn("[CoupleSpace] Could not get/create vault:", err.message || err);
      return null;
    }
  };

  /* ── Load message history for the vault ── */
  const loadMessages = async (vid) => {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("vault_id", vid)
      .order("created_at", { ascending: true });
    if (error) { console.warn("[CoupleSpace] loadMessages error:", error.message); return; }
    if (data && data.length > 0) {
      setMessages(data.map(rowToMessage));
    }
  };

  /* ── Set up vault + load history + realtime subscription ── */
  useEffect(() => {
    let channel;
    (async () => {
      const vid = await getOrCreateVault();
      if (!vid) return;
      setVaultId(vid);
      await loadMessages(vid);

      channel = supabase
        .channel(`messages:${vid}`)
        .on("postgres_changes",
          { event: "INSERT", schema: "public", table: "messages", filter: `vault_id=eq.${vid}` },
          (payload) => {
            setMessages(prev => {
              // Avoid duplicating a message we just inserted ourselves
              if (prev.some(m => m.id === payload.new.id)) return prev;
              return [...prev, rowToMessage(payload.new)];
            });
          }
        )
        .subscribe();
    })();

    return () => { if (channel) supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myAddress, partnerAddress]);

  /* ── Insert a message row into Supabase, returns the inserted row (or null) ── */
  const insertMessage = async (fields) => {
    if (!vaultId) return null;
    const { data, error } = await supabase
      .from("messages")
      .insert({ vault_id: vaultId, sender: normalizeAddress(myAddress), ...fields })
      .select()
      .single();
    if (error) { console.warn("[CoupleSpace] insertMessage error:", error.message); return null; }
    return data;
  };

  /* ── Upload a File/Blob to the chat-media bucket, scoped to this vault ── */
  const uploadChatMedia = async (fileOrBlob, name) => {
    const safeName = (name || "file").replace(/[^\w.\-]+/g, "_");
    const path = `${vaultId || "unassigned"}/${Date.now()}_${safeName}`;
    const url = await uploadToBucket(BUCKETS.CHAT_MEDIA, path, fileOrBlob);
    return { url, path };
  };

  const sendMessage = async () => {
    if(!chatInput.trim()) return;
    const text = chatInput.trim();
    setChatInput("");

    // Optimistic local bubble
    const tempId = `temp-${Date.now()}`;
    setMessages(p=>[...p,{id:tempId,from:"me",type:"text",text,time:nowTime()}]);

    const saved = await insertMessage({ type:"text", text });
    if (saved) {
      setMessages(p => p.map(m => m.id===tempId ? rowToMessage(saved) : m));
    }
  };

  /* ── Image attach ── */
  const handleImagePicked = async (e) => {
    const file = e.target.files?.[0];
    if(!file) return;
    setShowAttachMenu(false);
    e.target.value="";

    const tempId = `temp-${Date.now()}`;
    const previewUrl = URL.createObjectURL(file);
    setMessages(p=>[...p,{id:tempId,from:"me",type:"image",imageUrl:previewUrl,fileSize:file.size,time:nowTime(),pending:true}]);

    try {
      const { url } = await uploadChatMedia(file, file.name);
      const saved = await insertMessage({ type:"image", media_url:url, file_size:file.size, file_name:file.name });
      setMessages(p => p.map(m => m.id===tempId ? (saved ? rowToMessage(saved) : {...m, imageUrl:url, pending:false}) : m));
    } catch (err) {
      console.warn("[CoupleSpace] image upload failed:", err.message || err);
      setMessages(p => p.map(m => m.id===tempId ? {...m, pending:false, failed:true} : m));
    }
  };

  /* ── File attach ── */
  const handleFilePicked = async (e) => {
    const file = e.target.files?.[0];
    if(!file) return;
    setShowAttachMenu(false);
    e.target.value="";

    const tempId = `temp-${Date.now()}`;
    setMessages(p=>[...p,{id:tempId,from:"me",type:"file",fileName:file.name,fileSize:file.size,fileType:file.type,fileUrl:null,time:nowTime(),pending:true}]);

    try {
      const { url } = await uploadChatMedia(file, file.name);
      const saved = await insertMessage({ type:"file", media_url:url, file_name:file.name, file_size:file.size });
      setMessages(p => p.map(m => m.id===tempId ? (saved ? rowToMessage(saved) : {...m, fileUrl:url, pending:false}) : m));
    } catch (err) {
      console.warn("[CoupleSpace] file upload failed:", err.message || err);
      setMessages(p => p.map(m => m.id===tempId ? {...m, pending:false, failed:true} : m));
    }
  };

  /* ── Video file pick (record via camera input, or choose from gallery) ── */
  const handleVideoPicked = async (e) => {
    const file = e.target.files?.[0];
    if(!file) return;
    setShowAttachMenu(false);
    e.target.value="";

    const tempId = `temp-${Date.now()}`;
    const previewUrl = URL.createObjectURL(file);
    setMessages(p=>[...p,{id:tempId,from:"me",type:"video",videoUrl:previewUrl,fileSize:file.size,time:nowTime(),pending:true}]);

    try {
      const { url } = await uploadChatMedia(file, file.name || "video.mp4");
      const saved = await insertMessage({ type:"video", media_url:url, file_size:file.size, file_name:file.name });
      setMessages(p => p.map(m => m.id===tempId ? (saved ? rowToMessage(saved) : {...m, videoUrl:url, pending:false}) : m));
    } catch (err) {
      console.warn("[CoupleSpace] video upload failed:", err.message || err);
      setMessages(p => p.map(m => m.id===tempId ? {...m, pending:false, failed:true} : m));
    }
  };

  /* ── Voice / live video recording via MediaRecorder ── */
  const startRecording = async (type) => {
    setShowAttachMenu(false);
    setMediaError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaError("Recording isn't supported in this browser.");
      return;
    }
    try{
      const constraints = type==="video" ? {audio:true,video:{facingMode:"user"}} : {audio:true};
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      recordingStreamRef.current = stream;
      recordedChunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e)=>{ if(e.data.size>0) recordedChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const blob = new Blob(recordedChunksRef.current, {type: type==="video"?"video/webm":"audio/webm"});
        const previewUrl = URL.createObjectURL(blob);
        const seconds = recordingSecondsRef.current;
        recordingStreamRef.current?.getTracks().forEach(t=>t.stop());

        const tempId = `temp-${Date.now()}`;
        const msgType = type==="video" ? "video" : "voice";
        const urlField = type==="video" ? "videoUrl" : "audioUrl";
        setMessages(p=>[...p,{id:tempId,from:"me",type:msgType,[urlField]:previewUrl,duration:seconds,time:nowTime(),pending:true}]);

        try {
          const ext = type==="video" ? "webm" : "webm";
          const { url } = await uploadChatMedia(blob, `recording.${ext}`);
          const saved = await insertMessage({ type:msgType, media_url:url, duration:seconds });
          setMessages(p => p.map(m => m.id===tempId ? (saved ? rowToMessage(saved) : {...m, [urlField]:url, pending:false}) : m));
        } catch (err) {
          console.warn("[CoupleSpace] recording upload failed:", err.message || err);
          setMessages(p => p.map(m => m.id===tempId ? {...m, pending:false, failed:true} : m));
        }
      };
      mr.start();
      recordingSecondsRef.current = 0;
      setRecording({type, seconds:0});
      recordingTimerRef.current = setInterval(()=>{
        recordingSecondsRef.current += 1;
        setRecording(r=> r ? {...r, seconds:r.seconds+1} : r);
      },1000);
    }catch(err){
      setMediaError(type==="video"
        ? "Camera/mic access denied. You can still send a video file via 📎."
        : "Microphone access denied. Please allow mic permission to send voice notes.");
    }
  };

  const stopRecording = (send=true) => {
    clearInterval(recordingTimerRef.current);
    recordingTimerRef.current=null;
    if(mediaRecorderRef.current && mediaRecorderRef.current.state!=="inactive"){
      if(!send){
        // cancel: detach onstop side-effects by clearing chunks before stop
        recordedChunksRef.current=[];
        mediaRecorderRef.current.onstop = () => {
          recordingStreamRef.current?.getTracks().forEach(t=>t.stop());
        };
      }
      mediaRecorderRef.current.stop();
    }
    setRecording(null);
  };


  /* Savings */
  const handleContribute=()=>{
    const amt=parseFloat(contribAmount);
    if(!amt||amt<=0) return;
    setGoals(prev=>prev.map(g=>{
      if(g.id!==activeGoal.id) return g;
      const updated={...g,saved:g.saved+amt,myContrib:g.myContrib+amt};
      setActiveGoal(updated);
      return updated;
    }));
    setContribAmount("");
    setShowContributeModal(false);
  };

  const createGoal=()=>{
    if(!newGoal.label||!newGoal.target) return;
    const g={id:goals.length+1,label:newGoal.label,token:newGoal.token,target:parseFloat(newGoal.target),saved:0,myContrib:0,partnerContrib:0,myMonthlyCommit:0,partnerMonthlyCommit:0,myMisses:0,partnerMisses:0,releaseType:newGoal.releaseType,releaseValue:newGoal.releaseValue,destinationWallet:"0x...",status:"active",createdDate:new Date().toISOString().split('T')[0]};
    setGoals(p=>[...p,g]);
    setActiveGoal(g);
    setNewGoal({label:"",token:"USDC",target:"",releaseType:"percent",releaseValue:"80"});
    setShowCreateGoalModal(false);
  };

  /* ── Personal Savings handlers ── */
  const personalContribute=(goalId)=>{
    const amt=parseFloat(personalContribAmount);
    if(!amt||amt<=0) return;
    setPersonalGoals(prev=>prev.map(g=>{
      if(g.id!==goalId) return g;
      const month=new Date().toLocaleDateString("en-US",{month:"short"});
      const contribs=[...g.contributions];
      const last=contribs[contribs.length-1];
      if(last&&last.month===month){ last.amount+=amt; }
      else { contribs.push({month,amount:amt}); }
      const newSaved=g.saved+amt;
      let status=g.status;
      if(g.triggerType==="amount"&&newSaved>=parseFloat(g.triggerValue)) status="triggered";
      const updated={...g,saved:newSaved,contributions:contribs,status};
      if(activePersonalGoal?.id===goalId) setActivePersonalGoal(updated);
      return updated;
    }));
    setPersonalContribAmount(""); setShowPersonalContrib(false);
  };

  const createPersonalGoal=()=>{
    if(!newPersonalGoal.label||!newPersonalGoal.target||!newPersonalGoal.triggerValue) return;
    const g={
      id:personalGoals.length+1,
      label:newPersonalGoal.label,
      token:newPersonalGoal.token,
      target:parseFloat(newPersonalGoal.target),
      saved:0,
      triggerType:newPersonalGoal.triggerType,
      triggerValue:newPersonalGoal.triggerValue,
      destinationWallet:newPersonalGoal.destinationWallet||"0x7a2d…f9c3",
      status:"active",
      createdDate:new Date().toISOString().split("T")[0],
      contributions:[],
    };
    setPersonalGoals(p=>[...p,g]);
    setActivePersonalGoal(g);
    setNewPersonalGoal({label:"",token:"USDC",target:"",triggerType:"amount",triggerValue:"",destinationWallet:""});
    goTo(SCREENS.PERSONAL);
  };

  const personalRelease=(goalId)=>{
    setPersonalGoals(prev=>prev.map(g=>{
      if(g.id!==goalId) return g;
      const fee=Math.round(g.saved*0.02*100)/100;
      const net=+(g.saved-fee).toFixed(2);
      const updated={...g,status:"released",netReleased:net,fee};
      if(activePersonalGoal?.id===goalId) setActivePersonalGoal(updated);
      return updated;
    }));
  };

  const personalPct=(g)=> g ? Math.min(100,Math.round((g.saved/g.target)*100)) : 0;

  const personalTriggerLabel=(g)=>{
    if(!g) return "";
    if(g.triggerType==="amount") return `Unlocks at ${parseFloat(g.triggerValue).toLocaleString()} ${g.token}`;
    const d=new Date(g.triggerValue);
    return `Unlocks on ${d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}`;
  };

  /* Circle chat */
  const sendCircleMessage=()=>{
    if(!circleChatInput.trim()) return;
    const t=new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    setCircleChat(p=>[...p,{id:p.length+1,from:"You",color:"#1D9BF0",text:circleChatInput,time:t}]);
    setCircleChatInput("");
  };

  const pct = activeGoal ? Math.min(100,Math.round((activeGoal.saved/activeGoal.target)*100)) : 0;
  const displayName = myName || "Ahmed";
  const myInitial = myName ? myName[0].toUpperCase() : "A";
  const partnerInitial = partnerName ? partnerName[0].toUpperCase() : "P";

  /* SPLASH */
  if(screen===SCREENS.SPLASH) return (
    <div style={S.root}><FontLink/><Stars/>
      <div style={{...S.meshBg,background:"radial-gradient(ellipse 80% 60% at 50% 40%, rgba(29,155,240,0.45) 0%, rgba(80,20,100,0.2) 50%, transparent 100%)"}}/>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",position:"relative",zIndex:1}}>
        <div style={{position:"relative",opacity:splashStage>=1?1:0,transform:splashStage>=1?"scale(1)":"scale(0.8)",transition:"all 0.7s cubic-bezier(0.34,1.56,0.64,1)",marginBottom:32}}>
          <div style={{position:"absolute",inset:-20,borderRadius:"50%",border:"1px solid rgba(29,155,240,0.15)"}}/>
          <div style={{position:"absolute",width:10,height:10,background:"#1D9BF0",borderRadius:"50%",top:"50%",left:"50%",marginTop:-5,marginLeft:-5,animation:"orbit 6s linear infinite",boxShadow:"0 0 8px rgba(29,155,240,0.8)"}}/>
          <div style={{position:"absolute",inset:0,borderRadius:"50%",border:"2px solid rgba(29,155,240,0.4)",animation:"ripple 2s ease-out infinite"}}/>
          <div style={{width:96,height:96,borderRadius:"50%",background:"linear-gradient(135deg,rgba(29,155,240,0.6),rgba(80,20,100,0.8))",border:"1px solid rgba(29,155,240,0.4)",display:"flex",alignItems:"center",justifyContent:"center",animation:"pulseGlow 3s ease-in-out infinite",backdropFilter:"blur(10px)"}}>
            <span style={{fontSize:40,animation:"heartbeat 2.5s ease-in-out infinite",display:"block"}}>♡</span>
          </div>
        </div>
        <div style={{textAlign:"center",opacity:splashStage>=1?1:0,transform:splashStage>=1?"translateY(0)":"translateY(20px)",transition:"all 0.7s 0.2s ease"}}>
          <p style={{fontFamily:"'Cormorant Garamond',serif",fontSize:42,fontWeight:300,color:"#FFFFFF",letterSpacing:2,lineHeight:1}}>Couple<span style={{color:"#1D9BF0",fontStyle:"italic"}}>Space</span></p>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.6)",fontSize:13,letterSpacing:3,textTransform:"uppercase",marginTop:10,fontWeight:300}}>your private world · on-chain</p>
        </div>
        <div style={{display:"flex",gap:8,marginTop:52,opacity:splashStage>=2?1:0,transition:"opacity 0.5s"}}>
          {[0,1,2].map(i=>(<div key={i} style={{width:6,height:6,borderRadius:"50%",background:"#1D9BF0",animation:`blink 1.4s ${i*0.22}s ease-in-out infinite`}}/>))}
        </div>
      </div>
    </div>
  );

  /* ════════════════════════════════════════════════════════
     ZKLOGIN — the gate. Beautiful, reassuring, trustworthy.
  ════════════════════════════════════════════════════════ */
  if(screen===SCREENS.ZKLOGIN) return (
    <div style={S.root}><FontLink/><Stars/>
      <div style={{...S.meshBg,background:"radial-gradient(ellipse 90% 65% at 50% 0%, rgba(29,155,240,0.38) 0%, rgba(4,120,87,0.12) 55%, transparent 80%)"}}/>

      {/* Top wordmark */}
      <div style={{position:"relative",zIndex:1,padding:"52px 24px 0",textAlign:"center"}}>
        <div className="f1" style={{marginBottom:40}}>
          <div style={{position:"relative",width:80,height:80,margin:"0 auto 20px"}}>
            <div style={{position:"absolute",inset:-14,borderRadius:"50%",border:"1px solid rgba(29,155,240,0.12)"}}/>
            <div style={{position:"absolute",width:8,height:8,background:"#1D9BF0",borderRadius:"50%",top:"50%",left:"50%",marginTop:-4,marginLeft:-4,animation:"orbit 7s linear infinite",boxShadow:"0 0 6px rgba(29,155,240,0.9)"}}/>
            <div style={{position:"absolute",inset:0,borderRadius:"50%",border:"1.5px solid rgba(29,155,240,0.3)",animation:"ripple 2.4s ease-out infinite"}}/>
            <div style={{width:80,height:80,borderRadius:"50%",background:"linear-gradient(135deg,rgba(29,155,240,0.55),rgba(60,14,90,0.85))",border:"1px solid rgba(29,155,240,0.35)",display:"flex",alignItems:"center",justifyContent:"center",animation:"pulseGlow 3.5s ease-in-out infinite",backdropFilter:"blur(12px)"}}>
              <span style={{fontSize:34,animation:"heartbeat 2.8s ease-in-out infinite",display:"block"}}>♡</span>
            </div>
          </div>
          <h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:38,fontWeight:300,color:"#FFFFFF",lineHeight:1.1,letterSpacing:1}}>
            Couple<em style={{color:"#1D9BF0",fontWeight:400}}>Space</em>
          </h1>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.5)",fontSize:12,letterSpacing:2.5,textTransform:"uppercase",marginTop:10,fontWeight:300}}>your private world · on-chain</p>
        </div>

        {/* Loading state — shown while processing OAuth callback */}
        {zkLoading && (
          <div className="f2" style={{padding:"48px 0",textAlign:"center"}}>
            <div style={{display:"flex",gap:8,justifyContent:"center",marginBottom:20}}>
              {[0,1,2].map(i=>(<div key={i} style={{width:7,height:7,borderRadius:"50%",background:"#1D9BF0",animation:`blink 1.3s ${i*0.22}s ease-in-out infinite`}}/>))}
            </div>
            <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.6)",fontSize:14,fontWeight:300}}>Deriving your Sui address…</p>
            <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.3)",fontSize:11,marginTop:8,lineHeight:1.7}}>zkLogin is running. This takes 2–4 seconds.<br/>No seed phrase is ever created.</p>
          </div>
        )}

        {/* Error state */}
        {zkError && !zkLoading && (
          <div className="f2" style={{background:"rgba(239,68,68,0.08)",borderRadius:16,padding:"16px",border:"1px solid rgba(239,68,68,0.2)",marginBottom:20,textAlign:"left"}}>
            <p style={{fontFamily:"'DM Sans',sans-serif",color:"#EF4444",fontSize:13,fontWeight:500,margin:"0 0 4px"}}>Sign-in failed</p>
            <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(239,68,68,0.7)",fontSize:12,margin:0,lineHeight:1.6}}>{zkError}</p>
          </div>
        )}

        {/* Main sign-in card */}
        {!zkLoading && (
          <>
            <div className="f2" style={{background:"rgba(0,0,0,0.75)",borderRadius:24,padding:"28px 22px",border:"1px solid rgba(29,155,240,0.14)",backdropFilter:"blur(14px)",marginBottom:16,boxShadow:"0 8px 40px rgba(0,0,0,0.4)"}}>
              <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.45)",fontSize:11,fontWeight:600,letterSpacing:1.5,textTransform:"uppercase",marginBottom:20}}>Sign in to continue</p>

              {/* Google button */}
              <button
                onClick={handleGoogleSignIn}
                style={{width:"100%",padding:"16px 18px",borderRadius:16,background:"#fff",border:"none",display:"flex",alignItems:"center",gap:14,cursor:"pointer",marginBottom:12,boxShadow:"0 4px 20px rgba(0,0,0,0.35)",transition:"transform 0.15s,box-shadow 0.15s"}}
                onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-1px)";e.currentTarget.style.boxShadow="0 6px 28px rgba(0,0,0,0.45)";}}
                onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 4px 20px rgba(0,0,0,0.35)";}}>
                {/* Google logo SVG */}
                <svg width="20" height="20" viewBox="0 0 48 48" style={{flexShrink:0}}>
                  <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 2.9l5.7-5.7C34.1 6.5 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/>
                  <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.1 7.9 2.9l5.7-5.7C34.1 6.5 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
                  <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.3 35.3 26.8 36 24 36c-5.3 0-9.7-3.3-11.3-8H6.3C9.7 35.6 16.3 44 24 44z"/>
                  <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.2 5.2C42.5 35.3 44 30 44 24c0-1.3-.1-2.6-.4-3.9z"/>
                </svg>
                <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:15,fontWeight:600,color:"#3c4043",flex:1,textAlign:"left"}}>Continue with Google</span>
                <span style={{color:"#999",fontSize:13}}>→</span>
              </button>

              {/* Apple button */}
              <button
                style={{width:"100%",padding:"16px 18px",borderRadius:16,background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",display:"flex",alignItems:"center",gap:14,cursor:"not-allowed",opacity:0.45}}
                disabled>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" style={{flexShrink:0}}>
                  <path d="M18.7 12.4c0-3 2.5-4.5 2.6-4.6-1.4-2.1-3.6-2.3-4.4-2.4-1.9-.2-3.6 1.1-4.6 1.1-.9 0-2.4-1.1-3.9-1-2 0-3.9 1.2-4.9 3-2.1 3.6-.5 9 1.5 11.9 1 1.4 2.1 3 3.6 2.9 1.4-.1 2-1 3.7-1 1.7 0 2.2 1 3.7 1 1.6 0 2.6-1.5 3.6-2.9.7-1 1.2-2 1.6-3.2-3-.7-3.5-4.8-3.5-4.8zM15.7 3.4c.8-1 1.4-2.3 1.2-3.7-1.2.1-2.6.8-3.5 1.8-.8.9-1.5 2.3-1.3 3.6 1.4.1 2.7-.7 3.6-1.7z"/>
                </svg>
                <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:15,fontWeight:600,color:"#FFFFFF",flex:1,textAlign:"left"}}>Continue with Apple</span>
                <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"rgba(255,255,255,0.3)",background:"rgba(255,255,255,0.07)",padding:"3px 8px",borderRadius:20}}>coming soon</span>
              </button>
            </div>

            {/* How it works — trust builder */}
            <div className="f3" style={{background:"rgba(29,155,240,0.04)",borderRadius:18,padding:"18px 20px",border:"1px solid rgba(29,155,240,0.08)",marginBottom:16,textAlign:"left"}}>
              <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.4)",fontSize:10,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",marginBottom:14}}>How your wallet is created</p>
              {[
                {icon:"🔑", title:"Sign in with Google", desc:"Your Google account is your key — no seed phrase, no extensions."},
                {icon:"🧮", title:"Sui derives your address", desc:"zkLogin generates a unique Sui address from your sign-in — only you can control it."},
                {icon:"🔒", title:"Your keys, your money", desc:"Anthropic and CoupleSpace never hold your funds. Everything is on-chain."},
              ].map((s,i)=>(
                <div key={i} style={{display:"flex",gap:12,marginBottom:i<2?12:0,alignItems:"flex-start"}}>
                  <div style={{width:32,height:32,borderRadius:10,background:"rgba(29,155,240,0.12)",border:"1px solid rgba(29,155,240,0.1)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>{s.icon}</div>
                  <div>
                    <p style={{fontFamily:"'DM Sans',sans-serif",color:"#FFFFFF",fontSize:12,fontWeight:500,margin:"0 0 2px"}}>{s.title}</p>
                    <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.4)",fontSize:11,fontWeight:300,margin:0,lineHeight:1.6}}>{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Trust badges */}
            <div className="f4" style={{display:"flex",justifyContent:"center",gap:20,marginBottom:24}}>
              {[
                {icon:"⛓", label:"Sui blockchain"},
                {icon:"🛡", label:"zkLogin by Mysten"},
                {icon:"🔐", label:"Non-custodial"},
              ].map(b=>(
                <div key={b.label} style={{textAlign:"center"}}>
                  <div style={{fontSize:18,marginBottom:4}}>{b.icon}</div>
                  <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.3)",fontSize:9,fontWeight:500,letterSpacing:0.5}}>{b.label}</p>
                </div>
              ))}
            </div>

            <p className="f5" style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.2)",fontSize:10,textAlign:"center",lineHeight:1.9,letterSpacing:0.3}}>
              By continuing you agree to our Terms of Service.<br/>
              Your Google profile is only used to derive your address — we don't store it on our servers.
            </p>
          </>
        )}
      </div>
    </div>
  );

  /* LOGIN */
  if(screen===SCREENS.LOGIN) return (
    <div style={S.root}><FontLink/><Stars/><Petals/>
      <div style={{...S.meshBg,background:"radial-gradient(ellipse 80% 55% at 50% 0%, rgba(29,155,240,0.3) 0%, rgba(4,120,87,0.15) 60%, transparent 80%)"}}/>
      <div style={{padding:"56px 22px 40px",position:"relative",zIndex:1}}>

        {/* Brand */}
        <div className="f1" style={{textAlign:"center",marginBottom:36}}>
          <div style={{width:64,height:64,borderRadius:"50%",background:"linear-gradient(135deg,rgba(29,155,240,0.5),rgba(4,120,87,0.4))",border:"1px solid rgba(29,155,240,0.3)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 18px",boxShadow:"0 0 36px rgba(29,155,240,0.25), 0 0 36px rgba(16,185,129,0.15)"}}>
            <span style={{fontSize:28,animation:"heartbeat 3s infinite"}}>♡</span>
          </div>
          <h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:34,fontWeight:300,color:"#FFFFFF",lineHeight:1.2,letterSpacing:0.5}}>
            Welcome to<br/><em style={{color:"#1D9BF0",fontWeight:400}}>CoupleSpace</em>
          </h1>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.5)",fontSize:13,marginTop:10,fontWeight:300,lineHeight:1.7}}>
            Choose your space below
          </p>
        </div>

        {/* ── Couple Vault card ── */}
        <div className="f2" style={{background:"linear-gradient(145deg,rgba(29,155,240,0.18),rgba(80,20,100,0.3),rgba(0,0,0,0.7))",borderRadius:24,padding:"22px 20px",border:"1px solid rgba(29,155,240,0.2)",boxShadow:"0 8px 36px rgba(80,20,100,0.3)",marginBottom:14,cursor:"pointer",transition:"transform 0.2s"}}
          onClick={()=>goTo(SCREENS.SETUP)}>
          <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:14}}>
            <div style={{width:52,height:52,borderRadius:18,flexShrink:0,background:"linear-gradient(135deg,rgba(29,155,240,0.55),rgba(80,20,100,0.7))",border:"1px solid rgba(29,155,240,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,animation:"pulseGlow 3s ease-in-out infinite"}}>💜</div>
            <div style={{flex:1}}>
              <p style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:20,fontWeight:400,margin:"0 0 3px",letterSpacing:0.3}}>
                Couple <em style={{color:"#1D9BF0"}}>Vault</em>
              </p>
              <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.5)",fontSize:12,fontWeight:300,margin:0,lineHeight:1.5}}>
                Private · 2 people only · End-to-end encrypted
              </p>
            </div>
            <span style={{color:"rgba(29,155,240,0.45)",fontSize:20,flexShrink:0}}>→</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            {[{icon:"💬",label:"Private Chat"},{icon:"🗂️",label:"Memories"},{icon:"💰",label:"Savings Pool"}].map(f=>(
              <div key={f.label} style={{background:"rgba(29,155,240,0.08)",borderRadius:12,padding:"10px 8px",border:"1px solid rgba(29,155,240,0.1)",textAlign:"center"}}>
                <div style={{fontSize:18,marginBottom:4}}>{f.icon}</div>
                <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.6)",fontSize:10,fontWeight:400,margin:0,lineHeight:1.3}}>{f.label}</p>
              </div>
            ))}
          </div>
          <div style={{marginTop:14,background:"rgba(29,155,240,0.1)",borderRadius:10,padding:"8px 14px",border:"1px solid rgba(29,155,240,0.12)",display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:12}}>🔐</span>
            <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.4)",fontSize:11,fontWeight:300,margin:0}}>Requires partner address exchange · Just the two of you</p>
          </div>
        </div>

        {/* Divider */}
        <div className="f3" style={{display:"flex",alignItems:"center",gap:12,margin:"4px 0"}}>
          <div style={{flex:1,height:1,background:"linear-gradient(90deg,transparent,rgba(29,155,240,0.15))"}}/>
          <span style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.3)",fontSize:11,letterSpacing:1}}>OR</span>
          <div style={{flex:1,height:1,background:"linear-gradient(90deg,rgba(16,185,129,0.15),transparent)"}}/>
        </div>

        {/* ── Savings Circle card ── */}
        <div className="f4" style={{background:"linear-gradient(145deg,rgba(4,120,87,0.22),rgba(16,185,129,0.1),rgba(0,0,0,0.7))",borderRadius:24,padding:"22px 20px",border:"1px solid rgba(16,185,129,0.22)",boxShadow:"0 8px 36px rgba(4,120,87,0.2)",marginTop:14,cursor:"pointer",transition:"transform 0.2s"}}
          onClick={()=>goTo(SCREENS.CIRCLE_ENTRY)}>
          <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:14}}>
            <div style={{width:52,height:52,borderRadius:18,flexShrink:0,background:"linear-gradient(135deg,rgba(4,120,87,0.55),rgba(16,185,129,0.35))",border:"1px solid rgba(16,185,129,0.35)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,animation:"coopPulse 3s ease-in-out infinite"}}>⭕</div>
            <div style={{flex:1}}>
              <p style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:20,fontWeight:400,margin:"0 0 3px",letterSpacing:0.3}}>
                Savings <em style={{color:"#10B981"}}>Circle</em>
              </p>
              <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(16,185,129,0.55)",fontSize:12,fontWeight:300,margin:0,lineHeight:1.5}}>
                Ajo · Esusu · Tontine · Open to everyone
              </p>
            </div>
            <span style={{color:"rgba(16,185,129,0.5)",fontSize:20,flexShrink:0}}>→</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            {[{icon:"👥",label:"Group Saving"},{icon:"🔄",label:"Auto Rotation"},{icon:"🛡️",label:"Stake & Trust"}].map(f=>(
              <div key={f.label} style={{background:"rgba(16,185,129,0.06)",borderRadius:12,padding:"10px 8px",border:"1px solid rgba(16,185,129,0.12)",textAlign:"center"}}>
                <div style={{fontSize:18,marginBottom:4}}>{f.icon}</div>
                <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(16,185,129,0.6)",fontSize:10,fontWeight:400,margin:0,lineHeight:1.3}}>{f.label}</p>
              </div>
            ))}
          </div>
          <div style={{marginTop:14,background:"rgba(16,185,129,0.07)",borderRadius:10,padding:"8px 14px",border:"1px solid rgba(16,185,129,0.12)",display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:12}}>🌍</span>
            <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(16,185,129,0.45)",fontSize:11,fontWeight:300,margin:0}}>No partner needed · Create or join a circle now</p>
          </div>
        </div>

        {/* OR divider */}
        <div className="f4" style={{display:"flex",alignItems:"center",gap:12,margin:"4px 0"}}>
          <div style={{flex:1,height:1,background:"linear-gradient(90deg,transparent,rgba(245,158,11,0.15))"}}/>
          <span style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(245,158,11,0.3)",fontSize:11,letterSpacing:1}}>OR</span>
          <div style={{flex:1,height:1,background:"linear-gradient(90deg,rgba(245,158,11,0.15),transparent)"}}/>
        </div>

        {/* ── Personal Vault card ── */}
        <div className="f5" style={{background:"linear-gradient(145deg,rgba(120,80,4,0.22),rgba(245,158,11,0.08),rgba(0,0,0,0.7))",borderRadius:24,padding:"22px 20px",border:"1px solid rgba(245,158,11,0.2)",boxShadow:"0 8px 36px rgba(120,80,4,0.2)",marginTop:14,cursor:"pointer"}}
          onClick={()=>goTo(SCREENS.PERSONAL)}>
          <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:14}}>
            <div style={{width:52,height:52,borderRadius:18,flexShrink:0,background:"linear-gradient(135deg,rgba(120,80,4,0.55),rgba(245,158,11,0.35))",border:"1px solid rgba(245,158,11,0.35)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:24}}>🔒</div>
            <div style={{flex:1}}>
              <p style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:20,fontWeight:400,margin:"0 0 3px",letterSpacing:0.3}}>
                Personal <em style={{color:"#F59E0B"}}>Vault</em>
              </p>
              <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(245,158,11,0.55)",fontSize:12,fontWeight:300,margin:0,lineHeight:1.5}}>
                Private · Solo · Locked until trigger
              </p>
            </div>
            <span style={{color:"rgba(245,158,11,0.5)",fontSize:20,flexShrink:0}}>→</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            {[{icon:"🔐",label:"Private"},{icon:"🎯",label:"Goal-locked"},{icon:"⚡",label:"Auto-release"}].map(f=>(
              <div key={f.label} style={{background:"rgba(245,158,11,0.06)",borderRadius:12,padding:"10px 8px",border:"1px solid rgba(245,158,11,0.1)",textAlign:"center"}}>
                <div style={{fontSize:18,marginBottom:4}}>{f.icon}</div>
                <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(245,158,11,0.6)",fontSize:10,fontWeight:400,margin:0,lineHeight:1.3}}>{f.label}</p>
              </div>
            ))}
          </div>
          <div style={{marginTop:14,background:"rgba(245,158,11,0.07)",borderRadius:10,padding:"8px 14px",border:"1px solid rgba(245,158,11,0.1)",display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:12}}>👁️</span>
            <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(245,158,11,0.4)",fontSize:11,fontWeight:300,margin:0}}>Invisible to partner · Your eyes only</p>
          </div>
        </div>

        <p className="f6" style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.25)",fontSize:11,textAlign:"center",marginTop:22,letterSpacing:0.5,lineHeight:1.8}}>Powered by Sui zkLogin · Your keys, your future.</p>
      </div>
    </div>
  );

  /* SETUP */
  if(screen===SCREENS.SETUP) return (
    <div style={S.root}><FontLink/><Stars/>
      <div style={{...S.meshBg,background:"radial-gradient(ellipse 60% 40% at 50% 20%, rgba(29,155,240,0.35) 0%, transparent 70%)"}}/>
      <div style={{padding:"52px 24px 40px",position:"relative",zIndex:1}}>
        <button style={S.backBtn} onClick={()=>goTo(SCREENS.ZKLOGIN)}>← back</button>
        <div className="f1" style={{marginBottom:24,marginTop:8}}>
          <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,fontWeight:300,color:"#FFFFFF",lineHeight:1.25}}>Tell us<br/><em style={{color:"#1D9BF0"}}>who you are</em></h2>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.5)",fontSize:13,marginTop:8,lineHeight:1.7,fontWeight:300}}>Your name is how your partner sees you.<br/>Your Sui address is already ready.</p>
        </div>

        {/* Google profile hint */}
        {zkUser?.email && (
          <div className="f2" style={{display:"flex",alignItems:"center",gap:12,background:"rgba(29,155,240,0.07)",borderRadius:16,padding:"12px 16px",border:"1px solid rgba(29,155,240,0.12)",marginBottom:14}}>
            {zkUser.picture
              ? <img src={zkUser.picture} alt="" style={{width:36,height:36,borderRadius:"50%",objectFit:"cover",border:"1.5px solid rgba(29,155,240,0.3)"}}/>
              : <Avatar name={zkUser.name||"?"} size={36}/>}
            <div>
              <p style={{fontFamily:"'DM Sans',sans-serif",color:"#FFFFFF",fontSize:13,fontWeight:500,margin:0}}>{zkUser.name||"Signed in"}</p>
              <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.45)",fontSize:11,margin:"2px 0 0",fontWeight:300}}>{zkUser.email}</p>
            </div>
          </div>
        )}

        <div className="f3" style={{...S.card,marginBottom:14}}>
          <p style={S.cardEyebrow}>Your display name</p>
          <input style={S.input} placeholder={zkUser?.name?`e.g. ${zkUser.name.split(" ")[0]}`:"e.g. Ahmed"} value={nameInput} onChange={e=>setNameInput(e.target.value)}/>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.35)",fontSize:11,marginTop:8,lineHeight:1.6}}>This is how your partner will see you in the app.</p>
          {zkUser?.name && !nameInput && (
            <button style={{background:"rgba(29,155,240,0.15)",border:"1px solid rgba(29,155,240,0.2)",borderRadius:10,color:"#1D9BF0",fontSize:12,fontWeight:500,padding:"8px 14px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",marginTop:10}}
              onClick={()=>setNameInput(zkUser.name.split(" ")[0])}>
              Use "{zkUser.name.split(" ")[0]}" from Google →
            </button>
          )}
        </div>

        <div className="f4" style={{...S.card,marginBottom:14}}>
          <p style={S.cardEyebrow}>Your Sui address</p>
          <div style={{background:"rgba(29,155,240,0.08)",borderRadius:14,padding:"14px 16px",border:"1px solid rgba(29,155,240,0.15)",display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
            <span style={{fontFamily:"monospace",color:"#1D9BF0",fontSize:11,letterSpacing:0.5,wordBreak:"break-all",lineHeight:1.7}}>{myAddress}</span>
            <button style={{background:"rgba(29,155,240,0.3)",border:"1px solid rgba(29,155,240,0.3)",borderRadius:8,color:"#1D9BF0",fontSize:12,fontWeight:600,padding:"6px 14px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",flexShrink:0}}
              onClick={async()=>{const ok=await copyToClipboard(myAddress);if(ok){setCopied(true);setTimeout(()=>setCopied(false),2000);}}}>
              {copied?"Copied ✓":"Copy"}
            </button>
          </div>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.35)",fontSize:11,marginTop:8,lineHeight:1.6}}>Generated by Sui zkLogin — no seed phrase needed. Share with your partner to connect.</p>
        </div>

        <div className="f5"><button style={{...S.primaryBtn,opacity:nameInput.length>1?1:0.4}} onClick={()=>{if(nameInput.length>1){setMyName(nameInput);localStorage.setItem("cs_myName",nameInput);goTo(SCREENS.HANDSHAKE);}}} >Continue 💜</button></div>
      </div>
    </div>
  );

  /* HANDSHAKE */
  if(screen===SCREENS.HANDSHAKE) return (
    <div style={S.root}><FontLink/><Stars/>
      <div style={{...S.meshBg,background:"radial-gradient(ellipse 60% 40% at 50% 20%, rgba(29,155,240,0.35) 0%, transparent 70%)"}}/>
      <div style={{padding:"52px 24px 40px",position:"relative",zIndex:1}}>
        <button style={S.backBtn} onClick={()=>goTo(SCREENS.SETUP)}>← back</button>
        <div className="f1" style={{marginBottom:28,marginTop:8}}>
          <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,fontWeight:300,color:"#FFFFFF",lineHeight:1.25}}>Find your<br/><em style={{color:"#1D9BF0"}}>other half</em></h2>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.5)",fontSize:13,marginTop:8,lineHeight:1.7,fontWeight:300}}>Enter their Sui address like a phone number.<br/>They enter yours. Your vault opens.</p>
        </div>
        <div className="f2" style={{...S.card,marginBottom:14}}>
          <p style={S.cardEyebrow}>You</p>
          <div style={{display:"flex",alignItems:"center",gap:14}}>
            {zkUser?.picture
              ? <img src={zkUser.picture} alt="" style={{width:48,height:48,borderRadius:"50%",objectFit:"cover",border:"2px solid rgba(29,155,240,0.4)"}}/>
              : <Avatar name={nameInput||"A"} size={48}/>}
            <div style={{flex:1,minWidth:0}}>
              <p style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:18,fontWeight:400,margin:0}}>{nameInput||"Ahmed"}</p>
              <p style={{fontFamily:"monospace",color:"rgba(29,155,240,0.5)",fontSize:10,marginTop:3,wordBreak:"break-all",lineHeight:1.6}}>{myAddress}</p>
            </div>
            <button style={{background:"rgba(29,155,240,0.2)",border:"1px solid rgba(29,155,240,0.2)",borderRadius:8,color:"#1D9BF0",fontSize:11,fontWeight:600,padding:"5px 10px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",flexShrink:0}}
              onClick={async()=>{const ok=await copyToClipboard(myAddress);if(ok){setCopied(true);setTimeout(()=>setCopied(false),2000);}}}>
              {copied?"✓":"Copy"}
            </button>
          </div>
        </div>
        <div className="f3" style={S.card}>
          <p style={S.cardEyebrow}>Partner's Sui address</p>
          <input style={S.input} placeholder="0x... (their wallet address)" value={addressInput} onChange={e=>setAddressInput(e.target.value)}/>
          <input style={{...S.input,marginTop:12}} placeholder="Partner's name (e.g. Amaka)" value={partnerName} onChange={e=>setPartnerName(e.target.value)}/>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.35)",fontSize:11,marginTop:8,lineHeight:1.6}}>Enter both fields. Once connected, your Savings Pool opens on-chain — forever.</p>
          <button style={{...S.primaryBtn,marginTop:16,opacity:(addressInput.length>10&&partnerName.length>1)?1:0.4}}
            onClick={()=>{
              if(addressInput.length>10 && partnerName.length>1){
                setPartnerAddress(normalizeAddress(addressInput));
                goTo(SCREENS.HOME);
              }
            }}>
            Open Our Vault 💜
          </button>
        </div>
      </div>
    </div>
  );

  /* HOME */
  if(screen===SCREENS.HOME) return (
    <div style={S.root}><FontLink/><Stars/>
      <div style={{...S.meshBg,background:"radial-gradient(ellipse 80% 40% at 50% 0%, rgba(29,155,240,0.3) 0%, transparent 65%)"}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",padding:"52px 22px 16px",position:"relative",zIndex:1}}>
        <div className="f1">
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.5)",fontSize:13,fontWeight:300}}>Good morning,</p>
          <p style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:24,fontWeight:400,letterSpacing:0.3}}>{displayName} 🤍</p>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {zkUser?.picture
            ? <img src={zkUser.picture} alt="you" style={{width:46,height:46,borderRadius:"50%",border:"2px solid rgba(29,155,240,0.4)",objectFit:"cover",cursor:"pointer"}} onClick={signOut} title="Sign out"/>
            : <div onClick={signOut} title="Sign out" style={{cursor:"pointer"}}><Avatar name={myInitial} size={46}/></div>
          }
        </div>
      </div>
      <div style={{padding:"0 18px 110px",position:"relative",zIndex:1}}>
        <div className="f2" style={{background:"linear-gradient(145deg,rgba(29,155,240,0.25),rgba(80,20,100,0.4),rgba(30,10,50,0.6))",borderRadius:28,padding:"28px 22px",border:"1px solid rgba(29,155,240,0.2)",boxShadow:"0 12px 48px rgba(80,20,100,0.4), inset 0 1px 0 rgba(29,155,240,0.15)",marginBottom:20,textAlign:"center",backdropFilter:"blur(12px)",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",top:-30,left:"50%",transform:"translateX(-50%)",width:160,height:80,background:"radial-gradient(ellipse,rgba(29,155,240,0.2),transparent)",pointerEvents:"none"}}/>
          <div style={{display:"flex",justifyContent:"center",alignItems:"center",marginBottom:14}}>
            <div style={{...S.cAvatar,background:"linear-gradient(135deg,#1D9BF0,#5C1A6E)",boxShadow:"0 0 18px rgba(29,155,240,0.5)"}}>{myInitial}</div>
            <div style={{width:34,height:34,borderRadius:"50%",background:"rgba(15,5,25,0.7)",border:"1px solid rgba(29,155,240,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,animation:"heartbeat 2.5s ease-in-out infinite",zIndex:2,margin:"0 -4px"}}>♡</div>
            <div style={{...S.cAvatar,background:"linear-gradient(135deg,#1D9BF0,#0F1419)",boxShadow:"0 0 18px rgba(29,155,240,0.5)"}}>{partnerInitial}</div>
          </div>
          <p style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:20,fontWeight:400,letterSpacing:0.5,margin:"0 0 4px"}}>{displayName} & {partnerName||"Your Partner"}</p>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.55)",fontSize:12,fontWeight:300,margin:"0 0 16px"}}>✨ Connected · 247 beautiful days</p>
          <div style={{display:"inline-flex",alignItems:"center",gap:8,background:"rgba(29,155,240,0.15)",borderRadius:20,padding:"6px 16px",border:"1px solid rgba(29,155,240,0.15)"}}>
            <span style={{fontFamily:"'DM Mono',monospace",color:"rgba(29,155,240,0.7)",fontSize:11}}>Vault 0x7f3a…1b4c</span>
            <span style={{color:"rgba(29,155,240,0.5)",fontSize:10}}>🔐</span>
          </div>
        </div>

        <p style={S.sectionLabel}>Savings Together</p>
        <div className="f3" style={{background:"rgba(0,0,0,0.8)",borderRadius:22,padding:"20px",border:"1px solid rgba(29,155,240,0.15)",marginBottom:20,cursor:"pointer",boxShadow:"0 4px 24px rgba(0,0,0,0.3)"}} onClick={()=>{setActiveTab("savings");goTo(SCREENS.SAVINGS);}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
            <div>
              <p style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:28,fontWeight:400,letterSpacing:-0.5,margin:0}}>{activeGoal.saved} {activeGoal.token}</p>
              <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.5)",fontSize:12,margin:"4px 0 0",fontWeight:300}}>of {activeGoal.target} {activeGoal.token} goal · {activeGoal.label}</p>
            </div>
            <svg width="54" height="54" viewBox="0 0 54 54">
              <circle cx="27" cy="27" r="23" fill="none" stroke="rgba(29,155,240,0.2)" strokeWidth="4"/>
              <circle cx="27" cy="27" r="23" fill="none" stroke="url(#pg)" strokeWidth="4" strokeDasharray={`${2*Math.PI*23*(pct/100)} ${2*Math.PI*23*(1-pct/100)}`} strokeDashoffset={2*Math.PI*23*0.25} strokeLinecap="round"/>
              <defs><linearGradient id="pg" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#1D9BF0"/><stop offset="100%" stopColor="#1D9BF0"/></linearGradient></defs>
              <text x="27" y="31" textAnchor="middle" fill="#1D9BF0" fontSize="11" fontWeight="700" fontFamily="DM Sans">{pct}%</text>
            </svg>
          </div>
          <div style={{height:4,background:"rgba(29,155,240,0.15)",borderRadius:10,overflow:"hidden",marginBottom:12}}>
            <div style={{width:`${pct}%`,height:"100%",background:"linear-gradient(90deg,#1D9BF0,#1D9BF0)",borderRadius:10,transition:"width 0.6s ease"}}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{background:"rgba(29,155,240,0.15)",borderRadius:20,padding:"4px 12px",border:"1px solid rgba(29,155,240,0.15)"}}>
              <span style={{fontFamily:"'DM Sans',sans-serif",color:"#1D9BF0",fontSize:12}}>🎯 Active Goal</span>
            </div>
            <span style={{color:"rgba(29,155,240,0.5)",fontSize:18}}>→</span>
          </div>
        </div>

        <p style={S.sectionLabel}>Your Space</p>
        <div className="f4" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
          {[{icon:"💬",label:"Chat",sub:messages.length+" messages",screen:SCREENS.CHAT},{icon:"🗂️",label:"Memories",sub:memories.length+" files",screen:SCREENS.MEMORIES},{icon:"💰",label:"Savings",sub:goals.length+" goals",screen:SCREENS.SAVINGS}].map(a=>(
            <button key={a.label} style={{background:"rgba(0,0,0,0.8)",borderRadius:18,padding:"16px 14px",border:"1px solid rgba(29,155,240,0.1)",cursor:"pointer",textAlign:"left",boxShadow:"0 4px 20px rgba(29,155,240,0.15)",transition:"transform 0.2s"}} onClick={()=>goTo(a.screen)}>
              <span style={{fontSize:24,display:"block",marginBottom:10}}>{a.icon}</span>
              <p style={{fontFamily:"'DM Sans',sans-serif",color:"#FFFFFF",fontSize:13,fontWeight:600,margin:0}}>{a.label}</p>
              <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.45)",fontSize:11,margin:"3px 0 0",fontWeight:300}}>{a.sub}</p>
            </button>
          ))}
        </div>

        {/* ── Circle/Ajo entry card — separate section ── */}
        <div className="f5" style={{
          background:"linear-gradient(145deg,rgba(4,120,87,0.2),rgba(16,185,129,0.08),rgba(0,0,0,0.7))",
          borderRadius:22,padding:"20px",border:"1px solid rgba(16,185,129,0.2)",
          boxShadow:"0 4px 28px rgba(4,120,87,0.15)",marginBottom:4,
          display:"flex",alignItems:"center",gap:16,cursor:"pointer",
        }} onClick={()=>goTo(SCREENS.CIRCLE_ENTRY)}>
          <div style={{width:48,height:48,borderRadius:16,flexShrink:0,
            background:"linear-gradient(135deg,rgba(4,120,87,0.5),rgba(16,185,129,0.3))",
            border:"1px solid rgba(16,185,129,0.35)",display:"flex",alignItems:"center",
            justifyContent:"center",fontSize:22,animation:"coopPulse 3s ease-in-out infinite"}}>⭕</div>
          <div style={{flex:1}}>
            <p style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:17,fontWeight:400,margin:"0 0 3px",letterSpacing:0.3}}>
              Savings <em style={{color:"#10B981"}}>Circle</em>
            </p>
            <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(16,185,129,0.55)",fontSize:11,fontWeight:300,margin:0,lineHeight:1.5}}>
              Ajo · Esusu · Tontine — your own separate space
            </p>
          </div>
          <span style={{color:"rgba(16,185,129,0.5)",fontSize:18,flexShrink:0}}>→</span>
        </div>

        {/* ── Personal Vault entry card ── */}
        <div className="f6" style={{
          background:"linear-gradient(145deg,rgba(120,80,4,0.18),rgba(245,158,11,0.06),rgba(0,0,0,0.7))",
          borderRadius:22,padding:"20px",border:"1px solid rgba(245,158,11,0.15)",
          boxShadow:"0 4px 28px rgba(120,80,4,0.12)",marginTop:10,
          display:"flex",alignItems:"center",gap:16,cursor:"pointer",
        }} onClick={()=>goTo(SCREENS.PERSONAL)}>
          <div style={{width:48,height:48,borderRadius:16,flexShrink:0,
            background:"linear-gradient(135deg,rgba(120,80,4,0.5),rgba(245,158,11,0.3))",
            border:"1px solid rgba(245,158,11,0.3)",display:"flex",alignItems:"center",
            justifyContent:"center",fontSize:22}}>🔒</div>
          <div style={{flex:1}}>
            <p style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:17,fontWeight:400,margin:"0 0 3px",letterSpacing:0.3}}>
              Personal <em style={{color:"#F59E0B"}}>Vault</em>
            </p>
            <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(245,158,11,0.5)",fontSize:11,fontWeight:300,margin:0,lineHeight:1.5}}>
              {personalGoals.filter(g=>g.status!=="released").length} active goal{personalGoals.filter(g=>g.status!=="released").length!==1?"s":""} · Private · Your eyes only
            </p>
          </div>
          <span style={{color:"rgba(245,158,11,0.5)",fontSize:18,flexShrink:0}}>→</span>
        </div>
      </div>
      <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} goTo={goTo}/>
    </div>
  );

  /* CHAT */
  if(screen===SCREENS.CHAT) return (
    <div style={S.root}><FontLink/><Stars/>
      <div style={{display:"flex",alignItems:"center",gap:14,padding:"52px 20px 14px",position:"relative",zIndex:1,background:"rgba(0,0,0,0.85)",backdropFilter:"blur(20px)",borderBottom:"1px solid rgba(29,155,240,0.08)"}}>
        <button style={S.backBtn} onClick={()=>goTo(SCREENS.HOME)}>←</button>
        <Avatar name={partnerInitial} size={38} gradient="linear-gradient(135deg,#1D9BF0,#0F1419)" glow="rgba(29,155,240,0.5)"/>
        <div style={{flex:1}}>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"#FFFFFF",fontSize:14,fontWeight:600,margin:0}}>{partnerName}</p>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(16,185,129,0.7)",fontSize:11,margin:"2px 0 0",fontWeight:300}}>● Online</p>
        </div>
        <div style={{background:"rgba(78,205,196,0.1)",borderRadius:20,padding:"4px 10px",border:"1px solid rgba(78,205,196,0.2)"}}>
          <span style={{fontFamily:"'DM Sans',sans-serif",color:"#4ECDC4",fontSize:10,fontWeight:600}}>🔒 E2E</span>
        </div>
      </div>
      <div style={{height:"calc(100vh - 180px)",overflowY:"auto",padding:"16px 18px",display:"flex",flexDirection:"column",gap:14,position:"relative",zIndex:1}}>
        {messages.map(m=>(
          <div key={m.id} style={{display:"flex",gap:8,maxWidth:"80%",alignSelf:m.from==="me"?"flex-end":"flex-start",flexDirection:m.from==="me"?"row-reverse":"row",alignItems:"flex-end"}}>
            {m.from!=="me"&&<Avatar name={partnerInitial} size={26} gradient="linear-gradient(135deg,#1D9BF0,#0F1419)" glow="rgba(29,155,240,0.5)"/>}
            <div style={{minWidth:0}}>
              {/* TEXT */}
              {(!m.type||m.type==="text") && (
                <div style={{background:m.from==="me"?"linear-gradient(135deg,#1D9BF0,#1A8CD8)":"rgba(0,0,0,0.85)",border:m.from==="me"?"none":"1px solid rgba(29,155,240,0.12)",borderRadius:m.from==="me"?"16px 16px 4px 16px":"16px 16px 16px 4px",padding:"10px 14px",boxShadow:m.from==="me"?"0 4px 16px rgba(29,155,240,0.35)":"none"}}>
                  <p style={{fontFamily:"'DM Sans',sans-serif",color:"#FFFFFF",fontSize:14,margin:0,lineHeight:1.5}}>{m.text}</p>
                </div>
              )}

              {/* IMAGE */}
              {m.type==="image" && (
                <div style={{borderRadius:m.from==="me"?"16px 16px 4px 16px":"16px 16px 16px 4px",overflow:"hidden",border:"1px solid rgba(29,155,240,0.15)",maxWidth:220,position:"relative"}}>
                  <img src={m.imageUrl} alt="" style={{width:"100%",display:"block",maxHeight:280,objectFit:"cover",background:"#111",opacity:m.pending?0.5:1}}/>
                  {m.pending && (
                    <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.35)"}}>
                      <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#fff",background:"rgba(0,0,0,0.5)",borderRadius:20,padding:"4px 12px"}}>Sending…</span>
                    </div>
                  )}
                  {m.failed && (
                    <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(239,68,68,0.25)"}}>
                      <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#fff",background:"rgba(239,68,68,0.7)",borderRadius:20,padding:"4px 12px"}}>Failed to send</span>
                    </div>
                  )}
                </div>
              )}

              {/* VOICE NOTE */}
              {m.type==="voice" && (
                <div style={{background:m.from==="me"?"linear-gradient(135deg,#1D9BF0,#1A8CD8)":"rgba(0,0,0,0.85)",border:m.from==="me"?"none":"1px solid rgba(29,155,240,0.12)",borderRadius:m.from==="me"?"16px 16px 4px 16px":"16px 16px 16px 4px",padding:"10px 12px",boxShadow:m.from==="me"?"0 4px 16px rgba(29,155,240,0.35)":"none",display:"flex",alignItems:"center",gap:10,minWidth:180}}>
                  <span style={{fontSize:18,flexShrink:0}}>🎙️</span>
                  <div style={{display:"flex",alignItems:"center",gap:2,flex:1}}>
                    {Array.from({length:18}).map((_,i)=>(
                      <div key={i} style={{width:2,borderRadius:1,background:m.from==="me"?"rgba(255,255,255,0.5)":"rgba(29,155,240,0.4)",height:[6,12,8,16,10,14,7,18,9,11,15,8,13,6,17,10,12,9][i%18]}}/>
                    ))}
                  </div>
                  <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:m.from==="me"?"rgba(255,255,255,0.7)":"rgba(29,155,240,0.5)",flexShrink:0}}>{formatDuration(m.duration||0)}</span>
                  <audio src={m.audioUrl} controls style={{display:"none"}} id={`audio-${m.id}`}/>
                  <span style={{cursor:"pointer",fontSize:14,flexShrink:0}}
                    onClick={()=>{const a=document.getElementById(`audio-${m.id}`); if(a){a.controls=true; a.style.display="block"; a.play();}}}>
                    ▶
                  </span>
                </div>
              )}

              {/* VIDEO */}
              {m.type==="video" && (
                <div style={{borderRadius:m.from==="me"?"16px 16px 4px 16px":"16px 16px 16px 4px",overflow:"hidden",border:"1px solid rgba(29,155,240,0.15)",maxWidth:220,position:"relative"}}>
                  <video src={m.videoUrl} controls style={{width:"100%",display:"block",maxHeight:260,background:"#000",opacity:m.pending?0.5:1}}/>
                  {m.duration!=null && (
                    <div style={{padding:"4px 10px",background:"rgba(0,0,0,0.9)"}}>
                      <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"rgba(29,155,240,0.5)"}}>🎥 {formatDuration(m.duration)}</span>
                    </div>
                  )}
                  {m.pending && (
                    <div style={{position:"absolute",top:0,left:0,right:0,padding:"6px 10px"}}>
                      <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#fff",background:"rgba(0,0,0,0.6)",borderRadius:20,padding:"4px 12px"}}>Sending…</span>
                    </div>
                  )}
                  {m.failed && (
                    <div style={{position:"absolute",top:0,left:0,right:0,padding:"6px 10px"}}>
                      <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#fff",background:"rgba(239,68,68,0.7)",borderRadius:20,padding:"4px 12px"}}>Failed to send</span>
                    </div>
                  )}
                </div>
              )}

              {/* FILE */}
              {m.type==="file" && (
                <a href={m.fileUrl||"#"} download={m.fileName} target="_blank" rel="noreferrer" style={{textDecoration:"none",display:"flex",alignItems:"center",gap:10,background:m.from==="me"?"linear-gradient(135deg,#1D9BF0,#1A8CD8)":"rgba(0,0,0,0.85)",border:m.from==="me"?"none":"1px solid rgba(29,155,240,0.12)",borderRadius:m.from==="me"?"16px 16px 4px 16px":"16px 16px 16px 4px",padding:"10px 14px",boxShadow:m.from==="me"?"0 4px 16px rgba(29,155,240,0.35)":"none",minWidth:180,maxWidth:240,opacity:m.pending?0.6:1,pointerEvents:m.pending?"none":"auto"}}>
                  <span style={{fontSize:22,flexShrink:0}}>📄</span>
                  <div style={{flex:1,minWidth:0}}>
                    <p style={{fontFamily:"'DM Sans',sans-serif",color:"#FFFFFF",fontSize:12,fontWeight:500,margin:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{m.fileName}</p>
                    <p style={{fontFamily:"'DM Sans',sans-serif",color:m.from==="me"?"rgba(255,255,255,0.6)":"rgba(29,155,240,0.4)",fontSize:10,margin:"2px 0 0"}}>
                      {formatBytes(m.fileSize||0)} · {m.failed ? "Failed to send" : m.pending ? "Sending…" : "⬇ Download"}
                    </p>
                  </div>
                </a>
              )}

              <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.3)",fontSize:9,margin:"4px 6px 0",textAlign:m.from==="me"?"right":"left"}}>{m.time}</p>
            </div>
          </div>
        ))}
        <div ref={chatEndRef}/>
      </div>
      {/* Hidden inputs for image, file & video pick */}
      <input ref={imageInputRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleImagePicked}/>
      <input ref={fileInputRef} type="file" style={{display:"none"}} onChange={handleFilePicked}/>
      <input ref={videoInputRef} type="file" accept="video/*" capture="user" style={{display:"none"}} onChange={handleVideoPicked}/>

      {/* Media permission error toast */}
      {mediaError && (
        <div style={{position:"fixed",bottom:96,left:"50%",transform:"translateX(-50%)",width:"calc(100% - 32px)",maxWidth:398,background:"rgba(239,68,68,0.12)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:14,padding:"10px 14px",zIndex:150}}>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"#EF4444",fontSize:11,margin:0,lineHeight:1.6}}>{mediaError}</p>
        </div>
      )}

      {/* Attach menu */}
      {showAttachMenu && (
        <div style={{position:"fixed",bottom:88,left:"50%",transform:"translateX(-50%)",width:"calc(100% - 32px)",maxWidth:398,background:"rgba(0,0,0,0.97)",border:"1px solid rgba(29,155,240,0.15)",borderRadius:18,padding:14,display:"flex",justifyContent:"space-around",zIndex:150,backdropFilter:"blur(20px)",boxShadow:"0 8px 30px rgba(0,0,0,0.4)"}}>
          {[
            {icon:"🖼️",label:"Photo",action:()=>imageInputRef.current?.click()},
            {icon:"📄",label:"File",action:()=>fileInputRef.current?.click()},
            {icon:"🎥",label:"Video",action:()=>videoInputRef.current?.click()},
            {icon:"📹",label:"Record",action:()=>startRecording("video")},
            {icon:"🎙️",label:"Voice",action:()=>startRecording("voice")},
          ].map(opt=>(
            <button key={opt.label} onClick={opt.action} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,background:"none",border:"none",cursor:"pointer"}}>
              <div style={{width:46,height:46,borderRadius:14,background:"rgba(29,155,240,0.15)",border:"1px solid rgba(29,155,240,0.18)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{opt.icon}</div>
              <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:10,color:"rgba(29,155,240,0.55)"}}>{opt.label}</span>
            </button>
          ))}
        </div>
      )}

      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:"rgba(0,0,0,0.95)",backdropFilter:"blur(24px)",borderTop:"1px solid rgba(29,155,240,0.08)",padding:"12px 16px 28px",display:"flex",gap:10,zIndex:100}}>
        {recording ? (
          /* Recording-in-progress bar */
          <div style={{flex:1,background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:20,padding:"10px 16px",display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:10,height:10,borderRadius:"50%",background:"#EF4444",animation:"blink 1s ease-in-out infinite",flexShrink:0}}/>
            <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"#FFFFFF",flex:1}}>
              {recording.type==="video"?"Recording video…":"Recording voice note…"} {formatDuration(recording.seconds)}
            </span>
            <button onClick={()=>stopRecording(false)} style={{background:"none",border:"none",color:"rgba(29,155,240,0.5)",fontSize:18,cursor:"pointer",padding:0}}>🗑️</button>
          </div>
        ) : (
          <div style={{flex:1,background:"rgba(29,155,240,0.06)",border:"1px solid rgba(29,155,240,0.15)",borderRadius:20,padding:"10px 16px",display:"flex",alignItems:"center",gap:10}}>
            <span style={{color:"rgba(29,155,240,0.4)",fontSize:16,cursor:"pointer"}} onClick={()=>setShowAttachMenu(v=>!v)}>📎</span>
            <input style={{flex:1,background:"transparent",border:"none",fontFamily:"'DM Sans',sans-serif",fontSize:14,color:"#FFFFFF",outline:"none"}} placeholder="Send a message…" value={chatInput} onChange={e=>setChatInput(e.target.value)} onFocus={()=>setShowAttachMenu(false)} onKeyDown={e=>e.key==="Enter"&&sendMessage()}/>
          </div>
        )}

        {recording ? (
          <button style={{width:44,height:44,borderRadius:"50%",background:"linear-gradient(135deg,#10B981,#047857)",border:"none",color:"#fff",fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 16px rgba(16,185,129,0.4)",flexShrink:0}} onClick={()=>stopRecording(true)}>✓</button>
        ) : chatInput.trim() ? (
          <button style={{width:44,height:44,borderRadius:"50%",background:"linear-gradient(135deg,#1D9BF0,#1A8CD8)",border:"none",color:"#fff",fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 16px rgba(29,155,240,0.4)",flexShrink:0}} onClick={sendMessage}>➤</button>
        ) : (
          <button style={{width:44,height:44,borderRadius:"50%",background:"linear-gradient(135deg,#1D9BF0,#1A8CD8)",border:"none",color:"#fff",fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 16px rgba(29,155,240,0.4)",flexShrink:0}} onClick={()=>startRecording("voice")}>🎙️</button>
        )}
      </div>
    </div>
  );

  /* MEMORIES */
  if(screen===SCREENS.MEMORIES) return (
    <div style={S.root}><FontLink/><Stars/>
      <div style={{...S.meshBg,background:"radial-gradient(ellipse 70% 40% at 50% 0%, rgba(14,165,233,0.15) 0%, rgba(29,155,240,0.1) 50%, transparent 80%)"}}/>
      <div style={{padding:"52px 20px 14px",position:"relative",zIndex:1,background:"rgba(0,0,0,0.85)",backdropFilter:"blur(20px)",borderBottom:"1px solid rgba(29,155,240,0.08)"}}>
        <button style={S.backBtn} onClick={()=>goTo(SCREENS.HOME)}>← home</button>
        <h2 style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:28,fontWeight:300,letterSpacing:0.3,marginTop:4}}>Memory <em style={{color:"#1D9BF0"}}>Vault</em></h2>
      </div>
      <div style={{padding:"16px 18px 110px",position:"relative",zIndex:1}}>
        <div className="f1" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:20}}>
          {memories.map(item=>(
            <div key={item.id} style={{background:"rgba(0,0,0,0.85)",borderRadius:18,padding:"16px 14px",border:"1px solid rgba(29,155,240,0.1)",cursor:"pointer"}}>
              <div style={{width:40,height:40,borderRadius:12,background:`${item.color}22`,border:`1px solid ${item.color}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,marginBottom:10}}>{item.icon}</div>
              <p style={{fontFamily:"'DM Sans',sans-serif",color:"#FFFFFF",fontSize:12,fontWeight:500,margin:0,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{item.label}</p>
              <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.4)",fontSize:10,margin:"4px 0 0",fontWeight:300}}>{item.size||"2.4 MB"}</p>
            </div>
          ))}
        </div>
        <div className="f2" style={{background:"rgba(29,155,240,0.05)",borderRadius:22,padding:"28px 20px",border:"2px dashed rgba(29,155,240,0.2)",textAlign:"center",cursor:"pointer"}}>
          <div style={{fontSize:32,marginBottom:10}}>☁</div>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"#FFFFFF",fontSize:14,fontWeight:500,marginBottom:6}}>Drop files to upload</p>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.4)",fontSize:12,fontWeight:300}}>Encrypted before upload · Stored on Walrus</p>
          <button style={{...S.primaryBtn,marginTop:16,padding:"12px"}} onClick={()=>setShowUploadModal(true)}>+ Add Memory</button>
        </div>
      </div>
      <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} goTo={goTo}/>
    </div>
  );

  /* SAVINGS */
  if(screen===SCREENS.SAVINGS) return (
    <div style={S.root}><FontLink/><Stars/>
      <div style={{...S.meshBg,background:"radial-gradient(ellipse 70% 40% at 50% 0%, rgba(80,140,100,0.15) 0%, rgba(29,155,240,0.15) 50%, transparent 80%)"}}/>
      <div style={{padding:"52px 20px 14px",position:"relative",zIndex:1,background:"rgba(0,0,0,0.85)",backdropFilter:"blur(20px)",borderBottom:"1px solid rgba(29,155,240,0.08)"}}>
        <button style={S.backBtn} onClick={()=>goTo(SCREENS.HOME)}>← home</button>
        <h2 style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:28,fontWeight:300,letterSpacing:0.3,marginTop:4}}>Savings <em style={{color:"#1D9BF0"}}>Pool</em></h2>
      </div>
      <div style={{padding:"16px 18px 110px",position:"relative",zIndex:1}}>
        <p style={S.sectionLabel}>Goals</p>
        <div className="f1" style={{display:"flex",flexDirection:"column",gap:10,marginBottom:20}}>
          {goals.map(goal=>(
            <div key={goal.id} style={{background:"rgba(0,0,0,0.85)",borderRadius:18,padding:"16px",border:"1px solid rgba(29,155,240,0.1)",cursor:"pointer"}} onClick={()=>setActiveGoal(goal)}>
              <p style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:16,fontWeight:400,margin:"0 0 8px"}}>{goal.label}</p>
              <p style={{fontFamily:"'DM Mono',monospace",color:"rgba(29,155,240,0.5)",fontSize:11,margin:0}}>{goal.saved} / {goal.target} {goal.token}</p>
              <div style={{height:3,background:"rgba(29,155,240,0.15)",borderRadius:10,overflow:"hidden",marginTop:8}}>
                <div style={{width:`${Math.min(100,(goal.saved/goal.target)*100)}%`,height:"100%",background:"linear-gradient(90deg,#1D9BF0,#1D9BF0)",borderRadius:10}}/>
              </div>
            </div>
          ))}
          <button style={{...S.primaryBtn,padding:"14px",fontSize:14}} onClick={()=>setShowCreateGoalModal(true)}>+ Create New Goal</button>
        </div>

        {activeGoal && (
          <>
            <p style={S.sectionLabel}>Active Goal Details</p>
            <div className="f2" style={{...S.card,marginBottom:14}}>
              <p style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:20,fontWeight:400,margin:"0 0 12px"}}>{activeGoal.label}</p>
              <div style={{background:"rgba(29,155,240,0.08)",borderRadius:12,padding:"12px 14px",marginBottom:12}}>
                <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.5)",fontSize:11,fontWeight:300,margin:0}}>Release Trigger: {activeGoal.releaseType === "percent" ? `${activeGoal.releaseValue}% funded` : activeGoal.releaseType === "date" ? `On ${activeGoal.releaseValue}` : "By duration"}</p>
              </div>
              {[["My contribution",`${activeGoal.myContrib} ${activeGoal.token}`],["Partner's contribution",`${activeGoal.partnerContrib} ${activeGoal.token}`],["Progress",`${Math.min(100,Math.round((activeGoal.saved/activeGoal.target)*100))}%`],["My monthly target",`${activeGoal.myMonthlyCommit} ${activeGoal.token}`],["My misses",`${activeGoal.myMisses} month(s)`],["Protocol Fee on withdrawal","2%"]].map(([k,v])=>(
                <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0",borderBottom:"1px solid rgba(29,155,240,0.07)"}}>
                  <span style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.5)",fontSize:12}}>{k}</span>
                  <span style={{fontFamily:"'DM Mono',monospace",color:"#1D9BF0",fontSize:12}}>{v}</span>
                </div>
              ))}
              <button style={{...S.primaryBtn,marginTop:16,padding:"12px",fontSize:14}} onClick={()=>setShowContributeModal(true)}>+ Contribute</button>
            </div>
          </>
        )}
      </div>

      {showContributeModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:"rgba(0,0,0,0.95)",borderRadius:"24px 24px 0 0",padding:"24px",backdropFilter:"blur(20px)"}}>
            <h3 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,fontWeight:400,color:"#FFFFFF",marginBottom:12}}>Contribute to {activeGoal?.label}</h3>
            <input style={{...S.input,marginBottom:14}} placeholder="Amount" type="number" value={contribAmount} onChange={e=>setContribAmount(e.target.value)}/>
            <button style={{...S.primaryBtn,marginBottom:10}} onClick={handleContribute}>Contribute</button>
            <button style={{...S.primaryBtn,background:"transparent",border:"1px solid rgba(29,155,240,0.2)",color:"rgba(29,155,240,0.6)"}} onClick={()=>setShowContributeModal(false)}>Cancel</button>
          </div>
        </div>
      )}

      {showCreateGoalModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"flex-end",zIndex:200}}>
          <div style={{width:"100%",background:"rgba(0,0,0,0.95)",borderRadius:"24px 24px 0 0",padding:"24px",backdropFilter:"blur(20px)"}}>
            <h3 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,fontWeight:400,color:"#FFFFFF",marginBottom:12}}>Create New Goal</h3>
            <input style={{...S.input,marginBottom:12}} placeholder="Goal name" value={newGoal.label} onChange={e=>setNewGoal({...newGoal,label:e.target.value})}/>
            <input style={{...S.input,marginBottom:12}} placeholder="Target amount" type="number" value={newGoal.target} onChange={e=>setNewGoal({...newGoal,target:e.target.value})}/>
            <select style={{...S.input,marginBottom:12}} value={newGoal.releaseType} onChange={e=>setNewGoal({...newGoal,releaseType:e.target.value})}>
              <option value="percent">Release at % of goal</option>
              <option value="date">Release on date</option>
              <option value="duration">Release after months</option>
            </select>
            <button style={{...S.primaryBtn,marginBottom:10}} onClick={createGoal}>Create Goal</button>
            <button style={{...S.primaryBtn,background:"transparent",border:"1px solid rgba(29,155,240,0.2)",color:"rgba(29,155,240,0.6)"}} onClick={()=>setShowCreateGoalModal(false)}>Cancel</button>
          </div>
        </div>
      )}

      <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} goTo={goTo}/>
    </div>
  );

  /* CIRCLE ENTRY — public landing, no couple login needed */
  if(screen===SCREENS.CIRCLE_ENTRY) return (
    <div style={{...S.root,background:"#030d08"}}><FontLink/>
      <div style={{position:"absolute",inset:0,pointerEvents:"none",zIndex:0}}>
        {Array.from({length:20},(_,i)=>({x:Math.random()*100,y:Math.random()*100,s:Math.random()*1.8+0.8,d:Math.random()*4+2,delay:Math.random()*5})).map((st,i)=>(
          <div key={i} style={{position:"absolute",left:`${st.x}%`,top:`${st.y}%`,width:st.s,height:st.s,borderRadius:"50%",background:"#10B981",opacity:0.4,animation:`starTwinkle ${st.d}s ${st.delay}s ease-in-out infinite`}}/>
        ))}
      </div>
      <div style={{...S.meshBg,background:"radial-gradient(ellipse 70% 50% at 50% 0%, rgba(4,120,87,0.4) 0%, transparent 70%)"}}/>
      <div style={{padding:"52px 22px 40px",position:"relative",zIndex:1}}>

        <button style={{...S.backBtn,color:"rgba(16,185,129,0.5)"}} onClick={()=>goTo(SCREENS.LOGIN)}>← back</button>

        <div className="f1" style={{textAlign:"center",margin:"16px 0 28px"}}>
          <div style={{width:70,height:70,borderRadius:"50%",background:"linear-gradient(135deg,rgba(4,120,87,0.5),rgba(16,185,129,0.3))",border:"1px solid rgba(16,185,129,0.4)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 18px",boxShadow:"0 0 40px rgba(16,185,129,0.3)",animation:"coopPulse 3s ease-in-out infinite"}}>
            <span style={{fontSize:32}}>⭕</span>
          </div>
          <h1 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,fontWeight:300,color:"#ecfdf5",lineHeight:1.2,letterSpacing:0.5}}>
            Savings <em style={{color:"#10B981",fontWeight:400}}>Circle</em>
          </h1>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(16,185,129,0.55)",fontSize:13,marginTop:8,fontWeight:300,lineHeight:1.7}}>
            Ajo · Esusu · Tontine — reimagined on-chain.<br/>Open to everyone. No couple account required.
          </p>
        </div>

        <div className="f2" style={{display:"flex",flexWrap:"wrap",gap:8,justifyContent:"center",marginBottom:26}}>
          {["👥 2–20 members","🔄 Auto rotation","🛡️ Stake-based trust","💸 Any token","⏰ Grace period","🗳️ Kick vote"].map(f=>(
            <div key={f} style={{background:"rgba(16,185,129,0.08)",borderRadius:20,padding:"5px 14px",border:"1px solid rgba(16,185,129,0.15)"}}>
              <span style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(16,185,129,0.7)",fontSize:11,fontWeight:500}}>{f}</span>
            </div>
          ))}
        </div>

        <div className="f3" style={{background:"rgba(4,20,12,0.6)",borderRadius:20,padding:"18px",border:"1px solid rgba(16,185,129,0.12)",marginBottom:22}}>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(16,185,129,0.45)",fontSize:10,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",marginBottom:14}}>How it works</p>
          {[
            {n:"1",text:"Admin creates a circle — sets size, contribution & grace period"},
            {n:"2",text:"Members join by staking their share before the round starts"},
            {n:"3",text:"Contract randomly assigns payout slots on-chain"},
            {n:"4",text:"Every cycle, one member receives the full pool"},
            {n:"5",text:"Miss twice → auto-ejected. Stake covers missed rounds"},
          ].map(s=>(
            <div key={s.n} style={{display:"flex",alignItems:"flex-start",gap:12,marginBottom:10}}>
              <div style={{width:22,height:22,borderRadius:"50%",background:"rgba(16,185,129,0.15)",border:"1px solid rgba(16,185,129,0.25)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>
                <span style={{fontFamily:"'DM Sans',sans-serif",color:"#10B981",fontSize:10,fontWeight:700}}>{s.n}</span>
              </div>
              <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(236,253,245,0.6)",fontSize:12,fontWeight:300,margin:0,lineHeight:1.6}}>{s.text}</p>
            </div>
          ))}
        </div>

        <div className="f4" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
          <button style={{padding:"16px 12px",borderRadius:16,background:"linear-gradient(135deg,#047857,#10B981)",border:"none",color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",boxShadow:"0 6px 24px rgba(4,120,87,0.45)",letterSpacing:0.3}}
            onClick={()=>goTo(SCREENS.CIRCLE_LOGIN)}>
            Join a Circle
          </button>
          <button style={{padding:"16px 12px",borderRadius:16,background:"rgba(16,185,129,0.1)",border:"1px solid rgba(16,185,129,0.3)",color:"#10B981",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",letterSpacing:0.3}}
            onClick={()=>goTo(SCREENS.CIRCLE_REGISTER)}>
            Create Circle
          </button>
        </div>

        <div className="f5" style={{background:"rgba(4,20,12,0.5)",borderRadius:18,padding:"16px",border:"1px solid rgba(16,185,129,0.1)"}}>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(16,185,129,0.45)",fontSize:10,fontWeight:700,letterSpacing:1.5,textTransform:"uppercase",marginBottom:12}}>Active Circles</p>
          {circles.slice(0,2).map(c=>(
            <div key={c.id} style={{display:"flex",alignItems:"center",gap:12,padding:"10px 0",borderBottom:"1px solid rgba(16,185,129,0.07)"}}>
              <div style={{width:36,height:36,borderRadius:12,background:"rgba(16,185,129,0.12)",border:"1px solid rgba(16,185,129,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>⭕</div>
              <div style={{flex:1}}>
                <p style={{fontFamily:"'DM Sans',sans-serif",color:"#ecfdf5",fontSize:13,fontWeight:500,margin:0}}>{c.name}</p>
                <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(16,185,129,0.45)",fontSize:11,margin:"2px 0 0",fontWeight:300}}>{c.size} members · {c.contribution} {c.token}/cycle</p>
              </div>
              <div style={{background:"rgba(16,185,129,0.12)",borderRadius:20,padding:"3px 10px",border:"1px solid rgba(16,185,129,0.2)"}}>
                <span style={{fontFamily:"'DM Sans',sans-serif",color:"#10B981",fontSize:10,fontWeight:600}}>Active</span>
              </div>
            </div>
          ))}
          <button style={{width:"100%",padding:"12px",marginTop:12,borderRadius:12,background:"rgba(16,185,129,0.07)",border:"1px dashed rgba(16,185,129,0.2)",color:"rgba(16,185,129,0.6)",fontSize:12,fontFamily:"'DM Sans',sans-serif",cursor:"pointer",fontWeight:500}}
            onClick={()=>goTo(SCREENS.CIRCLE_LOGIN)}>
            Browse all circles →
          </button>
        </div>

        <p className="f6" style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(16,185,129,0.2)",fontSize:11,textAlign:"center",marginTop:18,letterSpacing:0.5,lineHeight:1.8}}>Powered by Sui · Permissionless · On-chain</p>
      </div>
    </div>
  );

  /* CIRCLE LOGIN */
  if(screen===SCREENS.CIRCLE_LOGIN) return (
    <div style={{...S.root,background:"#050f09"}}>
      <FontLink/><Stars/>
      {/* Green top accent bar — signals separate section */}
      <div style={{position:"fixed",top:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,height:3,background:"linear-gradient(90deg,transparent,#10B981,#34D399,#10B981,transparent)",zIndex:200}}/>
      <div style={{...S.meshBg,background:"radial-gradient(ellipse 70% 50% at 50% 0%, rgba(4,120,87,0.45) 0%, transparent 70%)"}}/>
      <div style={{padding:"52px 24px 120px",position:"relative",zIndex:1}}>
        <button style={{...S.backBtn,color:"rgba(16,185,129,0.5)",display:"flex",alignItems:"center",gap:6}} onClick={()=>goTo(SCREENS.CIRCLE_ENTRY)}>
          ← Back to Circle
        </button>
        <div className="f1" style={{marginBottom:28,marginTop:8,textAlign:"center"}}>
          <div style={{width:64,height:64,borderRadius:20,background:"linear-gradient(135deg,rgba(4,120,87,0.5),rgba(16,185,129,0.3))",border:"1px solid rgba(16,185,129,0.4)",display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",fontSize:28,animation:"coopPulse 3s ease-in-out infinite"}}>⭕</div>
          <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,fontWeight:300,color:"#FFFFFF",lineHeight:1.25}}>Savings <em style={{color:"#10B981"}}>Circle</em></h2>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(16,185,129,0.55)",fontSize:13,marginTop:6,fontWeight:300,lineHeight:1.6}}>Trustless rotating savings — Ajo, Esusu, Tontine on Sui.</p>
        </div>
        <div className="f2" style={{background:"rgba(16,185,129,0.05)",borderRadius:16,padding:"14px 16px",border:"1px solid rgba(16,185,129,0.15)",marginBottom:16}}>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(16,185,129,0.8)",fontSize:12,fontWeight:500,marginBottom:4}}>🔒 Completely Separate</p>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.5)",fontSize:11,fontWeight:300,lineHeight:1.65}}>Your circle activity is separate from your couple account. Same app — different keys.</p>
        </div>
        <div className="f3" style={{...S.card,marginBottom:14}}>
          <p style={S.cardEyebrow}>Join Existing Circle</p>
          <input style={{...S.input,marginBottom:12}} placeholder="Circle ID (e.g. CIRC-0x9f3a…)"/>
          <button style={{...S.primaryBtn,fontSize:14}}>Enter Circle Dashboard →</button>
        </div>
        <div className="f4" style={{textAlign:"center",marginBottom:16}}>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.4)",fontSize:13,marginBottom:10}}>or start your own</p>
          <button style={{...S.primaryBtn,background:"transparent",border:"1px solid rgba(16,185,129,0.35)",color:"#10B981",fontSize:14}} onClick={()=>setShowCircleCreateModal(true)}>Create a New Circle ⭕</button>
        </div>
        <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(16,185,129,0.25)",fontSize:11,textAlign:"center",lineHeight:1.7}}>Circle IDs are shared privately.<br/>Not listed on any public registry.</p>
      </div>
      <CircleNav circleTab={circleTab} setCircleTab={setCircleTab} goTo={goTo}/>

      {showCircleCreateModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:300,display:"flex",alignItems:"flex-end",justifyContent:"center"}}
          onClick={()=>setShowCircleCreateModal(false)}>
          <div style={{width:"100%",maxWidth:430,background:"rgba(4,14,9,0.98)",borderRadius:"24px 24px 0 0",padding:"28px 24px 48px",border:"1px solid rgba(16,185,129,0.2)",backdropFilter:"blur(20px)"}}
            onClick={e=>e.stopPropagation()}>
            <p style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:22,fontWeight:300,marginBottom:6}}>
              New <em style={{color:"#10B981"}}>Circle</em>
            </p>
            <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(16,185,129,0.4)",fontSize:12,marginBottom:20,fontWeight:300}}>
              Or set up the full details on the next screen.
            </p>
            <input style={{...S.input,marginBottom:12,borderColor:"rgba(16,185,129,0.2)"}}
              placeholder="Circle name" value={newCircle.name}
              onChange={e=>setNewCircle(p=>({...p,name:e.target.value}))}/>
            <input style={{...S.input,marginBottom:20,borderColor:"rgba(16,185,129,0.2)"}}
              placeholder="Monthly contribution (USDC)" type="number" value={newCircle.contribution}
              onChange={e=>setNewCircle(p=>({...p,contribution:e.target.value}))}/>
            <button style={{width:"100%",padding:"14px",borderRadius:14,background:"linear-gradient(135deg,#047857,#10B981)",border:"none",color:"#fff",fontSize:14,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",marginBottom:10}}
              onClick={()=>{setShowCircleCreateModal(false);goTo(SCREENS.CIRCLE_REGISTER);}}>
              Continue to full setup →
            </button>
            <button style={{width:"100%",padding:"12px",borderRadius:14,background:"transparent",border:"1px solid rgba(16,185,129,0.2)",color:"rgba(16,185,129,0.5)",fontSize:13,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}
              onClick={()=>setShowCircleCreateModal(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );

  /* CIRCLE PORTAL */
  if(screen===SCREENS.CIRCLE_PORTAL) return (
    <div style={{...S.root,background:"#050f09"}}><FontLink/><Stars/>
      {/* Green top accent bar */}
      <div style={{position:"fixed",top:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,height:3,background:"linear-gradient(90deg,transparent,#10B981,#34D399,#10B981,transparent)",zIndex:200}}/>
      <div style={{...S.meshBg,background:"radial-gradient(ellipse 70% 40% at 50% 0%, rgba(4,120,87,0.35) 0%, rgba(16,185,129,0.05) 60%, transparent 100%)"}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"48px 20px 14px",position:"sticky",top:0,zIndex:20,background:"rgba(5,15,9,0.92)",backdropFilter:"blur(20px)",borderBottom:"1px solid rgba(16,185,129,0.12)"}}>
        <div>
          <button style={{...S.backBtn,color:"rgba(16,185,129,0.5)"}} onClick={()=>goTo(SCREENS.CIRCLE_LOGIN)}>← exit</button>
          <p style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:22,fontWeight:400,letterSpacing:0.3}}>Sunrise <em style={{color:"#10B981"}}>Ajo</em></p>
        </div>
        <button style={{background:"rgba(29,155,240,0.2)",border:"1px solid rgba(29,155,240,0.25)",borderRadius:12,padding:"6px 12px",color:"#1D9BF0",fontFamily:"'DM Sans',sans-serif",fontSize:11,fontWeight:600,cursor:"pointer"}} onClick={()=>goTo(SCREENS.CIRCLE_CHAT)}>💬 Chat</button>
      </div>
      <div style={{display:"flex",gap:6,padding:"12px 16px",position:"sticky",top:84,zIndex:19,background:"rgba(5,15,9,0.95)",backdropFilter:"blur(16px)",overflowX:"auto",borderBottom:"1px solid rgba(16,185,129,0.08)"}}>
        {[["pool","📊 Pool"],["members","👥 Members"],["rules","📜 Rules"],["contract","⛓ Contract"]].map(([id,label])=>(
          <button key={id} style={{flexShrink:0,padding:"8px 14px",borderRadius:20,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:500,
            background:circleTab===id?"rgba(16,185,129,0.18)":"rgba(4,15,9,0.8)",
            border:circleTab===id?"1px solid rgba(16,185,129,0.5)":"1px solid rgba(16,185,129,0.1)",
            color:circleTab===id?"#10B981":"rgba(16,185,129,0.35)"}} onClick={()=>setCircleTab(id)}>{label}</button>
        ))}
      </div>
      <div style={{padding:"12px 18px 140px",position:"relative",zIndex:1}}>
        {circleTab==="pool"&&(
          <>
            <div className="f1" style={{background:"linear-gradient(145deg,rgba(4,120,87,0.2),rgba(16,185,129,0.1),rgba(0,0,0,0.7))",borderRadius:28,padding:"28px 22px",textAlign:"center",border:"1px solid rgba(16,185,129,0.2)",marginBottom:18}}>
              <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(16,185,129,0.6)",fontSize:12,fontWeight:300,marginBottom:6}}>Monthly Pool · Round 1</p>
              <p style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:44,fontWeight:300,letterSpacing:-1,margin:"0 0 4px"}}>{activeCircle.monthlyPool} USDC</p>
              <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.5)",fontSize:13,margin:"0 0 16px"}}>{activeCircle.members.filter(m=>m.paid).length} of {activeCircle.members.length} members paid</p>
            </div>
            <p style={S.sectionLabel}>Members Status</p>
            <div className="f2">
              {activeCircle.members.map((m,i)=>(
                <div key={m.addr} style={{display:"flex",alignItems:"center",gap:12,background:m.misses>=2?"rgba(245,158,11,0.06)":"rgba(0,0,0,0.7)",borderRadius:16,padding:"12px 14px",marginBottom:8,border:m.misses>=2?"1px solid rgba(245,158,11,0.2)":"1px solid rgba(29,155,240,0.08)"}}>
                  <div style={{width:30,height:30,borderRadius:"50%",background:m.misses>=2?"rgba(245,158,11,0.25)":"rgba(16,185,129,0.15)",border:"1px solid rgba(16,185,129,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:600}}>#{m.slot}</div>
                  <div style={{flex:1}}>
                    <p style={{fontFamily:"'DM Sans',sans-serif",color:"#FFFFFF",fontSize:13,fontWeight:500,margin:0}}>{m.name} {m.misses>=2&&"⚠️"}</p>
                    <p style={{fontFamily:"'DM Mono',monospace",color:"rgba(29,155,240,0.35)",fontSize:10,margin:"3px 0 0"}}>{m.addr}</p>
                  </div>
                  <div style={{width:24,height:24,borderRadius:"50%",background:m.paid?"rgba(16,185,129,0.15)":"rgba(239,68,68,0.1)",border:`1px solid ${m.paid?"rgba(16,185,129,0.4)":"rgba(239,68,68,0.3)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:m.paid?"#10B981":"#EF4444"}}>
                    {m.paid?"✓":"!"}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {circleTab==="members"&&(
          <div className="f1">
            <p style={S.sectionLabel}>All Members</p>
            {activeCircle.members.map(m=>(
              <div key={m.addr} style={{background:"rgba(0,0,0,0.7)",borderRadius:16,padding:"14px",marginBottom:8,border:"1px solid rgba(29,155,240,0.08)"}}>
                <p style={{fontFamily:"'DM Sans',sans-serif",color:"#FFFFFF",fontSize:13,fontWeight:500,margin:0}}>{m.name}</p>
                <p style={{fontFamily:"'DM Mono',monospace",color:"rgba(29,155,240,0.4)",fontSize:10,margin:"4px 0 0"}}>{m.addr}</p>
                <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.3)",fontSize:11,margin:"6px 0 0"}}>Slot #{m.slot} · Stake: {m.stake} USDC</p>
              </div>
            ))}
          </div>
        )}
        {circleTab==="rules"&&(
          <div className="f1" style={{...S.card}}>
            <p style={S.cardEyebrow}>Circle Rules (Smart Contract Enforced)</p>
            {[["3-Day Grace","Members have 3 days after deadline to pay"],["Miss 1","Stake covers payment, marked defaulter"],["Miss 2","Auto-ejected from circle"],["Payout Order","Random draw at start, non-transferable"],["Stake Return","Only after payout + all remaining contributions complete"],["Fee","2% on every payout release"]].map(([title,desc])=>(
              <div key={title} style={{marginBottom:12,paddingBottom:12,borderBottom:"1px solid rgba(29,155,240,0.07)"}}>
                <p style={{fontFamily:"'DM Sans',sans-serif",color:"#10B981",fontSize:13,fontWeight:600,margin:0}}>{title}</p>
                <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.45)",fontSize:11,margin:"4px 0 0",fontWeight:300}}>{desc}</p>
              </div>
            ))}
          </div>
        )}
        {circleTab==="contract"&&(
          <div className="f1" style={{...S.card}}>
            <p style={S.cardEyebrow}>Live Contract State</p>
            <p style={{fontFamily:"'DM Mono',monospace",color:"#1D9BF0",fontSize:11,marginBottom:8,wordBreak:"break-all"}}>0xCircleAjo2026…CIRC-9f3a</p>
            {[["circle_id","CIRC-0x9f3a"],["token","USDC"],["contribution","100 USDC"],["members","6"],["current_round","1"],["pool_balance","600 USDC"],["grace_period","3 days"]].map(([k,v])=>(
              <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid rgba(29,155,240,0.07)",fontSize:11}}>
                <span style={{fontFamily:"'DM Mono',monospace",color:"#4ECDC4"}}>{k}</span>
                <span style={{fontFamily:"'DM Mono',monospace",color:"#F0C060"}}>{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <CircleNav circleTab={circleTab} setCircleTab={setCircleTab} goTo={goTo}/>
    </div>
  );

  /* CIRCLE CHAT */
  if(screen===SCREENS.CIRCLE_CHAT) return (
    <div style={{...S.root,background:"#050f09"}}><FontLink/><Stars/>
      {/* Green top accent bar */}
      <div style={{position:"fixed",top:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,height:3,background:"linear-gradient(90deg,transparent,#10B981,#34D399,#10B981,transparent)",zIndex:200}}/>
      <div style={{display:"flex",alignItems:"center",gap:12,padding:"52px 20px 14px",position:"sticky",top:0,zIndex:20,background:"rgba(5,15,9,0.92)",backdropFilter:"blur(20px)",borderBottom:"1px solid rgba(16,185,129,0.12)"}}>
        <button style={{...S.backBtn,color:"rgba(16,185,129,0.5)"}} onClick={()=>goTo(SCREENS.CIRCLE_PORTAL)}>←</button>
        <div style={{width:38,height:38,borderRadius:12,background:"linear-gradient(135deg,rgba(4,120,87,0.5),rgba(16,185,129,0.3))",border:"1px solid rgba(16,185,129,0.4)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>⭕</div>
        <div style={{flex:1}}>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"#FFFFFF",fontSize:14,fontWeight:600,margin:0}}>Sunrise Ajo — Group Chat</p>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(16,185,129,0.6)",fontSize:11,margin:"2px 0 0",fontWeight:300}}>6 members · 🔒 E2E</p>
        </div>
      </div>
      <div style={{height:"calc(100vh - 180px)",overflowY:"auto",padding:"16px 18px",display:"flex",flexDirection:"column",gap:12,position:"relative",zIndex:1}}>
        {circleChat.map(m=>(
          <div key={m.id} style={{display:"flex",gap:10,maxWidth:"85%",flexDirection:"row",alignItems:"flex-end"}}>
            <div style={{width:24,height:24,borderRadius:"50%",background:m.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:"#fff",flexShrink:0,fontFamily:"'DM Sans',sans-serif"}}>{m.from[0]}</div>
            <div>
              <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(29,155,240,0.45)",fontSize:9,marginBottom:3}}>{m.from} · {m.time}</p>
              <div style={{background:"rgba(0,0,0,0.85)",border:"1px solid rgba(29,155,240,0.1)",borderRadius:12,padding:"10px 14px"}}>
                <p style={{fontFamily:"'DM Sans',sans-serif",color:"#FFFFFF",fontSize:12,margin:0,lineHeight:1.5}}>{m.text}</p>
              </div>
            </div>
          </div>
        ))}
        <div ref={circleChatEndRef}/>
      </div>
      <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:"rgba(4,12,8,0.97)",backdropFilter:"blur(24px)",borderTop:"1px solid rgba(16,185,129,0.15)",padding:"12px 16px 28px",display:"flex",gap:10,zIndex:100}}>
        <div style={{flex:1,background:"rgba(16,185,129,0.06)",border:"1px solid rgba(16,185,129,0.2)",borderRadius:20,padding:"10px 16px",display:"flex",alignItems:"center",gap:10}}>
          <span style={{color:"rgba(16,185,129,0.4)",fontSize:16,cursor:"pointer"}}>📎</span>
          <input style={{flex:1,background:"transparent",border:"none",fontFamily:"'DM Sans',sans-serif",fontSize:14,color:"#FFFFFF",outline:"none"}} placeholder="Send a message…" value={circleChatInput} onChange={e=>setCircleChatInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&sendCircleMessage()}/>
        </div>
        <button style={{width:44,height:44,borderRadius:"50%",background:"linear-gradient(135deg,#047857,#10B981)",border:"none",color:"#fff",fontSize:18,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 4px 16px rgba(16,185,129,0.4)",flexShrink:0}} onClick={sendCircleMessage}>➤</button>
      </div>
    </div>
  );

  /* CIRCLE REGISTER — Create a new circle */
  if(screen===SCREENS.CIRCLE_REGISTER) return (
    <div style={{...S.root,background:"#050f09"}}>
      <FontLink/><Stars/>
      <div style={{position:"fixed",top:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,height:3,background:"linear-gradient(90deg,transparent,#10B981,#34D399,#10B981,transparent)",zIndex:200}}/>
      <div style={{...S.meshBg,background:"radial-gradient(ellipse 70% 50% at 50% 0%, rgba(4,120,87,0.45) 0%, transparent 70%)"}}/>
      <div style={{padding:"52px 24px 120px",position:"relative",zIndex:1}}>
        <button style={{...S.backBtn,color:"rgba(16,185,129,0.5)"}} onClick={()=>goTo(SCREENS.CIRCLE_ENTRY)}>← Back</button>

        <div className="f1" style={{marginBottom:28,marginTop:8}}>
          <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:32,fontWeight:300,color:"#FFFFFF",lineHeight:1.25}}>
            Create a <em style={{color:"#10B981"}}>Circle</em>
          </h2>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(16,185,129,0.55)",fontSize:13,marginTop:6,fontWeight:300,lineHeight:1.6}}>
            You'll be the admin. Share the Circle ID with members.
          </p>
        </div>

        <div className="f2" style={{...S.card,marginBottom:14,borderColor:"rgba(16,185,129,0.15)"}}>
          <p style={{...S.cardEyebrow,color:"rgba(16,185,129,0.5)"}}>Circle name</p>
          <input style={{...S.input,marginBottom:14,borderColor:"rgba(16,185,129,0.2)"}}
            placeholder="e.g. Sunrise Ajo"
            value={newCircle.name}
            onChange={e=>setNewCircle(p=>({...p,name:e.target.value}))}/>

          <p style={{...S.cardEyebrow,color:"rgba(16,185,129,0.5)"}}>Number of members</p>
          <div style={{display:"flex",gap:8,marginBottom:14}}>
            {["4","6","8","12"].map(n=>(
              <button key={n} style={{flex:1,padding:"12px 0",borderRadius:12,cursor:"pointer",
                fontFamily:"'DM Sans',sans-serif",fontSize:14,fontWeight:600,
                background:newCircle.size===n?"rgba(4,120,87,0.35)":"rgba(4,15,9,0.8)",
                border:newCircle.size===n?"1px solid rgba(16,185,129,0.5)":"1px solid rgba(16,185,129,0.1)",
                color:newCircle.size===n?"#10B981":"rgba(16,185,129,0.35)"}}
                onClick={()=>setNewCircle(p=>({...p,size:n}))}>{n}</button>
            ))}
          </div>

          <p style={{...S.cardEyebrow,color:"rgba(16,185,129,0.5)"}}>Monthly contribution</p>
          <input style={{...S.input,marginBottom:14,fontSize:18,fontWeight:300,borderColor:"rgba(16,185,129,0.2)"}}
            placeholder="e.g. 100"
            type="number"
            value={newCircle.contribution}
            onChange={e=>setNewCircle(p=>({...p,contribution:e.target.value}))}/>

          <p style={{...S.cardEyebrow,color:"rgba(16,185,129,0.5)"}}>Token</p>
          <div style={{display:"flex",gap:10,marginBottom:0}}>
            {["USDC","SUI"].map(t=>(
              <button key={t} style={{flex:1,padding:"12px",borderRadius:12,cursor:"pointer",
                fontFamily:"'DM Sans',sans-serif",fontSize:14,fontWeight:600,
                background:newCircle.token===t?"rgba(4,120,87,0.35)":"rgba(4,15,9,0.8)",
                border:newCircle.token===t?"1px solid rgba(16,185,129,0.5)":"1px solid rgba(16,185,129,0.1)",
                color:newCircle.token===t?"#10B981":"rgba(16,185,129,0.35)"}}
                onClick={()=>setNewCircle(p=>({...p,token:t}))}>{t}</button>
            ))}
          </div>
        </div>

        <div className="f3" style={{...S.card,marginBottom:20,borderColor:"rgba(16,185,129,0.15)"}}>
          <p style={{...S.cardEyebrow,color:"rgba(16,185,129,0.5)"}}>Grace period (days)</p>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(16,185,129,0.4)",fontSize:12,marginBottom:12,fontWeight:300,lineHeight:1.5}}>
            Days after deadline before a miss is recorded.
          </p>
          <div style={{display:"flex",gap:8}}>
            {["1","3","5","7"].map(d=>(
              <button key={d} style={{flex:1,padding:"12px 0",borderRadius:12,cursor:"pointer",
                fontFamily:"'DM Sans',sans-serif",fontSize:14,fontWeight:600,
                background:newCircle.gracePeriod===d?"rgba(4,120,87,0.35)":"rgba(4,15,9,0.8)",
                border:newCircle.gracePeriod===d?"1px solid rgba(16,185,129,0.5)":"1px solid rgba(16,185,129,0.1)",
                color:newCircle.gracePeriod===d?"#10B981":"rgba(16,185,129,0.35)"}}
                onClick={()=>setNewCircle(p=>({...p,gracePeriod:d}))}>{d}d</button>
            ))}
          </div>
        </div>

        {newCircle.name && newCircle.contribution && (
          <div className="f4" style={{...S.card,marginBottom:20,background:"rgba(4,120,87,0.1)",borderColor:"rgba(16,185,129,0.2)"}}>
            <p style={{...S.cardEyebrow,color:"rgba(16,185,129,0.5)"}}>Preview</p>
            <p style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:18,fontWeight:400,margin:"0 0 6px"}}>{newCircle.name}</p>
            <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(16,185,129,0.6)",fontSize:12,margin:0,lineHeight:1.6}}>
              {newCircle.size} members · {newCircle.contribution} {newCircle.token}/cycle · {parseInt(newCircle.size)*(parseInt(newCircle.contribution)||0)} {newCircle.token} pool · {newCircle.gracePeriod}-day grace
            </p>
          </div>
        )}

        <div className="f5">
          <button style={{width:"100%",padding:"16px",borderRadius:16,background:"linear-gradient(135deg,#047857,#10B981)",border:"none",color:"#fff",fontSize:15,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",boxShadow:"0 6px 24px rgba(4,120,87,0.45)",letterSpacing:0.3,
            opacity:(newCircle.name&&newCircle.contribution)?1:0.4}}
            onClick={()=>{
              if(!newCircle.name||!newCircle.contribution) return;
              const circleId=`CIRC-0x${Math.random().toString(16).slice(2,8)}`;
              const c={id:circles.length+1,name:newCircle.name,circleId,size:parseInt(newCircle.size),contribution:parseInt(newCircle.contribution),token:newCircle.token,gracePeriod:parseInt(newCircle.gracePeriod),createdDate:new Date().toISOString().split('T')[0],status:"active",members:[{addr:"0x7a2d…f9c3",name:displayName,slot:1,paid:true,misses:0,received:false,stake:parseInt(newCircle.contribution)}],currentRound:1,currentSlot:1,monthlyPool:parseInt(newCircle.contribution)};
              setCircles(p=>[...p,c]);
              setActiveCircle(c);
              setNewCircle({name:"",size:"6",contribution:"100",token:"USDC",gracePeriod:"3"});
              goTo(SCREENS.CIRCLE_PORTAL);
            }}>
            Deploy Circle ⭕
          </button>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(16,185,129,0.25)",fontSize:11,textAlign:"center",marginTop:12,lineHeight:1.8}}>
            On-chain · Permissionless · 2% fee on payouts
          </p>
        </div>
      </div>
    </div>
  );

  /* ══════════════════════════════════════════
     PERSONAL SAVINGS — screen
  ══════════════════════════════════════════ */
  if(screen===SCREENS.PERSONAL) {
    const activeGoals = personalGoals.filter(g=>g.status!=="released");
    const releasedGoals = personalGoals.filter(g=>g.status==="released");
    const display = activePersonalGoal || personalGoals[0];

    return (
      <div style={{...S.root,background:"#000000"}}>
        <FontLink/>
        <Stars/>
        {/* Gold accent bar */}
        <div style={{position:"fixed",top:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,height:3,background:"linear-gradient(90deg,transparent,#F59E0B,#FCD34D,#F59E0B,transparent)",zIndex:200}}/>
        <div style={{...S.meshBg,background:"radial-gradient(ellipse 70% 45% at 50% 0%, rgba(120,80,4,0.35) 0%, transparent 70%)"}}/>

        <div style={{padding:"52px 22px 110px",position:"relative",zIndex:1}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
            <div>
              <button style={{...S.backBtn,color:"rgba(245,158,11,0.5)"}} onClick={()=>goTo(SCREENS.HOME)}>← back</button>
              <h2 style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:26,fontWeight:300,marginTop:4}}>
                Personal <em style={{color:"#F59E0B"}}>Vault</em>
              </h2>
            </div>
            <div style={{width:42,height:42,borderRadius:14,background:"linear-gradient(135deg,rgba(120,80,4,0.6),rgba(245,158,11,0.3))",border:"1px solid rgba(245,158,11,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>🔒</div>
          </div>

          {/* Privacy notice */}
          <div style={{background:"rgba(245,158,11,0.06)",borderRadius:14,padding:"12px 16px",marginBottom:20,border:"1px solid rgba(245,158,11,0.12)",display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:14}}>👁️</span>
            <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(245,158,11,0.55)",fontSize:12,fontWeight:300,margin:0,lineHeight:1.5}}>
              Fully private. Only you can see this. Partner has zero visibility.
            </p>
          </div>

          {/* Contribute modal */}
          {showPersonalContrib && display && (
            <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:300,display:"flex",alignItems:"flex-end",justifyContent:"center"}}
              onClick={()=>setShowPersonalContrib(false)}>
              <div style={{background:"rgba(12,9,2,0.98)",borderRadius:"24px 24px 0 0",padding:"28px 24px 44px",width:"100%",maxWidth:430,border:"1px solid rgba(245,158,11,0.2)"}}
                onClick={e=>e.stopPropagation()}>
                <p style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:22,fontWeight:300,marginBottom:6}}>
                  Add to <em style={{color:"#F59E0B"}}>{display.label}</em>
                </p>
                <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(245,158,11,0.4)",fontSize:12,marginBottom:20,fontWeight:300}}>
                  {personalTriggerLabel(display)} · Locked until trigger
                </p>
                <p style={S.cardEyebrow}>Amount ({display.token})</p>
                <input style={{...S.input,marginBottom:20,fontSize:20,fontWeight:300,borderColor:"rgba(245,158,11,0.25)"}}
                  placeholder="0.00" type="number"
                  value={personalContribAmount} onChange={e=>setPersonalContribAmount(e.target.value)}/>
                <button style={{...S.primaryBtn,background:"linear-gradient(135deg,#92400E,#D97706)",boxShadow:"0 6px 24px rgba(120,80,4,0.5)",opacity:parseFloat(personalContribAmount)>0?1:0.4}}
                  onClick={()=>personalContribute(display.id)}>
                  Save {personalContribAmount||"0"} {display.token} 🔒
                </button>
                <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(245,158,11,0.3)",fontSize:11,textAlign:"center",marginTop:10}}>
                  Locked until trigger · 2% fee on release
                </p>
              </div>
            </div>
          )}

          {/* Goals list */}
          {personalGoals.length === 0 && (
            <div style={{textAlign:"center",padding:"48px 0"}}>
              <p style={{fontSize:40,marginBottom:12}}>🔒</p>
              <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(245,158,11,0.4)",fontSize:14}}>
                No personal goals yet.<br/>Create your first private goal.
              </p>
            </div>
          )}

          {activeGoals.map((g,i)=>{
            const p=personalPct(g);
            const isTriggered = g.status==="triggered" ||
              (g.triggerType==="date" && new Date(g.triggerValue)<=new Date());
            return (
              <div key={g.id} className={i===0?"f1":"f2"} style={{
                background:activePersonalGoal?.id===g.id
                  ?"linear-gradient(145deg,rgba(120,80,4,0.2),rgba(245,158,11,0.1),rgba(10,8,0,0.7))"
                  :"rgba(15,10,2,0.85)",
                borderRadius:22,padding:"20px",marginBottom:12,
                border:activePersonalGoal?.id===g.id
                  ?"1px solid rgba(245,158,11,0.3)":"1px solid rgba(245,158,11,0.1)",
                cursor:"pointer",
              }} onClick={()=>setActivePersonalGoal(g)}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                  <div style={{flex:1}}>
                    <p style={{fontFamily:"'DM Sans',sans-serif",color:"#FFFFFF",fontSize:15,fontWeight:600,margin:"0 0 3px"}}>{g.label}</p>
                    <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(245,158,11,0.45)",fontSize:11,margin:0,fontWeight:300}}>
                      {personalTriggerLabel(g)}
                    </p>
                  </div>
                  <div style={{textAlign:"right",marginLeft:12}}>
                    <p style={{fontFamily:"'Cormorant Garamond',serif",color:"#F59E0B",fontSize:20,fontWeight:400,margin:0}}>{p}%</p>
                    {isTriggered && <span style={{fontFamily:"'DM Sans',sans-serif",color:"#10B981",fontSize:10,fontWeight:600}}>✓ TRIGGERED</span>}
                  </div>
                </div>

                {/* Progress */}
                <div style={{height:4,background:"rgba(245,158,11,0.1)",borderRadius:10,overflow:"hidden",marginBottom:10}}>
                  <div style={{width:`${p}%`,height:"100%",background:"linear-gradient(90deg,#92400E,#F59E0B)",borderRadius:10,transition:"width 0.6s ease"}}/>
                </div>

                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(245,158,11,0.6)",fontSize:12,margin:0}}>
                    {g.saved.toLocaleString()} / {g.target.toLocaleString()} {g.token}
                  </p>
                  {isTriggered ? (
                    <button style={{padding:"7px 14px",borderRadius:12,cursor:"pointer",
                      background:"linear-gradient(135deg,#047857,#10B981)",border:"none",
                      fontFamily:"'DM Sans',sans-serif",color:"#fff",fontSize:11,fontWeight:600}}
                      onClick={e=>{e.stopPropagation();personalRelease(g.id);}}>
                      Release 💸
                    </button>
                  ) : (
                    <button style={{padding:"7px 14px",borderRadius:12,cursor:"pointer",
                      background:"rgba(245,158,11,0.1)",border:"1px solid rgba(245,158,11,0.25)",
                      fontFamily:"'DM Sans',sans-serif",color:"#F59E0B",fontSize:11,fontWeight:600}}
                      onClick={e=>{e.stopPropagation();setActivePersonalGoal(g);setShowPersonalContrib(true);}}>
                      + Add
                    </button>
                  )}
                </div>

                {/* Mini history */}
                {activePersonalGoal?.id===g.id && g.contributions.length>0 && (
                  <div style={{marginTop:14,paddingTop:14,borderTop:"1px solid rgba(245,158,11,0.08)"}}>
                    <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(245,158,11,0.4)",fontSize:10,fontWeight:600,letterSpacing:1,textTransform:"uppercase",marginBottom:8}}>History</p>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      {g.contributions.map((c,ci)=>(
                        <div key={ci} style={{background:"rgba(245,158,11,0.08)",borderRadius:10,padding:"6px 10px",border:"1px solid rgba(245,158,11,0.12)"}}>
                          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(245,158,11,0.5)",fontSize:9,margin:"0 0 2px"}}>{c.month}</p>
                          <p style={{fontFamily:"'DM Sans',sans-serif",color:"#F59E0B",fontSize:12,fontWeight:600,margin:0}}>{c.amount}</p>
                        </div>
                      ))}
                    </div>
                    <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(245,158,11,0.3)",fontSize:11,marginTop:10}}>
                      Destination: {g.destinationWallet}
                    </p>
                  </div>
                )}
              </div>
            );
          })}

          {/* Released goals */}
          {releasedGoals.length>0 && (
            <div style={{marginTop:8}}>
              <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(245,158,11,0.3)",fontSize:11,fontWeight:600,letterSpacing:1,textTransform:"uppercase",marginBottom:10}}>Released</p>
              {releasedGoals.map(g=>(
                <div key={g.id} style={{background:"rgba(15,10,2,0.6)",borderRadius:18,padding:"16px",marginBottom:8,border:"1px solid rgba(245,158,11,0.06)",opacity:0.7}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div>
                      <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(255,255,255,0.6)",fontSize:13,fontWeight:500,margin:0}}>{g.label}</p>
                      <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(245,158,11,0.35)",fontSize:11,margin:"3px 0 0"}}>Released · Net: {g.netReleased} {g.token} · Fee: {g.fee}</p>
                    </div>
                    <span style={{fontSize:18}}>✓</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Create new goal button */}
          <button style={{...S.primaryBtn,marginTop:12,background:"linear-gradient(135deg,#92400E,#D97706)",boxShadow:"0 6px 24px rgba(120,80,4,0.45)"}}
            onClick={()=>goTo(SCREENS.PERSONAL_CREATE)}>
            + New Personal Goal
          </button>

          <div style={{textAlign:"center",padding:"14px",border:"1px solid rgba(245,158,11,0.07)",borderRadius:14,marginTop:14}}>
            <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(245,158,11,0.25)",fontSize:11}}>
              🔒 Locked until trigger fires · 2% fee on release · Private on-chain
            </p>
          </div>
        </div>
      <BottomNav activeTab="personal" setActiveTab={setActiveTab} goTo={goTo}/>
      </div>
    );
  }

  /* ══════════════════════════════════════════
     PERSONAL CREATE — screen
  ══════════════════════════════════════════ */
  if(screen===SCREENS.PERSONAL_CREATE) return (
    <div style={{...S.root,background:"#000000"}}>
      <FontLink/><Stars/>
      <div style={{position:"fixed",top:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,height:3,background:"linear-gradient(90deg,transparent,#F59E0B,#FCD34D,#F59E0B,transparent)",zIndex:200}}/>
      <div style={{...S.meshBg,background:"radial-gradient(ellipse 60% 40% at 50% 0%, rgba(120,80,4,0.3) 0%, transparent 70%)"}}/>

      <div style={{padding:"52px 24px 100px",position:"relative",zIndex:1}}>
        <button style={{...S.backBtn,color:"rgba(245,158,11,0.5)"}} onClick={()=>goTo(SCREENS.PERSONAL)}>← back</button>
        <div className="f1" style={{marginBottom:24,marginTop:8}}>
          <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:30,fontWeight:300,color:"#FFFFFF",lineHeight:1.25}}>
            New <em style={{color:"#F59E0B"}}>Private Goal</em>
          </h2>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(245,158,11,0.45)",fontSize:13,marginTop:6,fontWeight:300,lineHeight:1.7}}>
            Solo · Invisible to partner · Locked until your trigger fires.
          </p>
        </div>

        <div className="f2" style={{...S.card,marginBottom:14,borderColor:"rgba(245,158,11,0.12)"}}>
          <p style={S.cardEyebrow}>Goal name</p>
          <input style={{...S.input,marginBottom:14,borderColor:"rgba(245,158,11,0.18)"}}
            placeholder="e.g. Emergency Fund 🛡️"
            value={newPersonalGoal.label} onChange={e=>setNewPersonalGoal(p=>({...p,label:e.target.value}))}/>

          <p style={S.cardEyebrow}>Target amount</p>
          <input style={{...S.input,marginBottom:14,fontSize:18,fontWeight:300,borderColor:"rgba(245,158,11,0.18)"}}
            placeholder="0.00" type="number"
            value={newPersonalGoal.target} onChange={e=>setNewPersonalGoal(p=>({...p,target:e.target.value}))}/>

          <p style={S.cardEyebrow}>Token</p>
          <div style={{display:"flex",gap:10,marginBottom:14}}>
            {["USDC","SUI"].map(t=>(
              <button key={t} style={{flex:1,padding:"12px",borderRadius:12,cursor:"pointer",
                fontFamily:"'DM Sans',sans-serif",fontSize:14,fontWeight:600,
                background:newPersonalGoal.token===t?"rgba(120,80,4,0.35)":"rgba(10,8,0,0.8)",
                border:newPersonalGoal.token===t?"1px solid rgba(245,158,11,0.5)":"1px solid rgba(245,158,11,0.1)",
                color:newPersonalGoal.token===t?"#F59E0B":"rgba(245,158,11,0.35)"}}
                onClick={()=>setNewPersonalGoal(p=>({...p,token:t}))}>{t}</button>
            ))}
          </div>
        </div>

        {/* Lock trigger (Rule 3) */}
        <div className="f3" style={{...S.card,marginBottom:14,borderColor:"rgba(245,158,11,0.12)"}}>
          <p style={S.cardEyebrow}>Lock trigger</p>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(245,158,11,0.35)",fontSize:12,marginBottom:14,fontWeight:300,lineHeight:1.5}}>
            Funds are fully locked until this fires. No early exit.
          </p>
          <div style={{display:"flex",gap:10,marginBottom:14}}>
            {[["amount","🎯 Target reached"],["date","📅 Specific date"]].map(([v,l])=>(
              <button key={v} style={{flex:1,padding:"13px",borderRadius:12,cursor:"pointer",
                fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:500,
                background:newPersonalGoal.triggerType===v?"rgba(120,80,4,0.35)":"rgba(10,8,0,0.8)",
                border:newPersonalGoal.triggerType===v?"1px solid rgba(245,158,11,0.5)":"1px solid rgba(245,158,11,0.1)",
                color:newPersonalGoal.triggerType===v?"#F59E0B":"rgba(245,158,11,0.35)"}}
                onClick={()=>setNewPersonalGoal(p=>({...p,triggerType:v,triggerValue:""}))}>
                {l}
              </button>
            ))}
          </div>

          {newPersonalGoal.triggerType==="amount" && (
            <>
              <p style={S.cardEyebrow}>Unlock when saved ({newPersonalGoal.token})</p>
              <input style={{...S.input,borderColor:"rgba(245,158,11,0.18)"}}
                placeholder={newPersonalGoal.target||"Same as target"}
                type="number"
                value={newPersonalGoal.triggerValue}
                onChange={e=>setNewPersonalGoal(p=>({...p,triggerValue:e.target.value}))}/>
            </>
          )}
          {newPersonalGoal.triggerType==="date" && (
            <>
              <p style={S.cardEyebrow}>Unlock on date</p>
              <input style={{...S.input,borderColor:"rgba(245,158,11,0.18)"}}
                type="date"
                value={newPersonalGoal.triggerValue}
                onChange={e=>setNewPersonalGoal(p=>({...p,triggerValue:e.target.value}))}/>
            </>
          )}
        </div>

        {/* Destination wallet */}
        <div className="f4" style={{...S.card,marginBottom:24,borderColor:"rgba(245,158,11,0.12)"}}>
          <p style={S.cardEyebrow}>Destination wallet</p>
          <input style={{...S.input,borderColor:"rgba(245,158,11,0.18)"}}
            placeholder="Default: your wallet (0x7a2d…f9c3)"
            value={newPersonalGoal.destinationWallet}
            onChange={e=>setNewPersonalGoal(p=>({...p,destinationWallet:e.target.value}))}/>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(245,158,11,0.3)",fontSize:11,marginTop:8,lineHeight:1.5}}>
            Auto-releases here when trigger fires. 2% fee deducted.
          </p>
        </div>

        <div className="f5">
          <button style={{...S.primaryBtn,
            background:"linear-gradient(135deg,#92400E,#D97706)",
            boxShadow:"0 6px 24px rgba(120,80,4,0.5)",
            opacity:(newPersonalGoal.label&&newPersonalGoal.target&&newPersonalGoal.triggerValue)?1:0.4}}
            onClick={createPersonalGoal}>
            Lock It In 🔒
          </button>
          <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(245,158,11,0.25)",fontSize:11,textAlign:"center",marginTop:12,lineHeight:1.8}}>
            No early exit · Auto-releases on trigger · 2% fee
          </p>
        </div>
      </div>
      <BottomNav activeTab="personal" setActiveTab={setActiveTab} goTo={goTo}/>
    </div>
  );

  /* ══════════════════════════════════════════
     WALLET SCREEN
  ══════════════════════════════════════════ */
  if (screen === SCREENS.WALLET) {
    const displayName = myName || zkUser?.name?.split(" ")[0] || "You";
    return (
      <div style={S.root}>
        <FontLink/><Stars/>
        <div style={{...S.meshBg, background:"radial-gradient(ellipse 70% 40% at 50% 0%, rgba(59,130,246,0.2) 0%, rgba(29,155,240,0.15) 60%, transparent 90%)"}}/>

        {/* Send Modal */}
        {showSendModal && (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:300,display:"flex",alignItems:"flex-end",justifyContent:"center"}}
            onClick={()=>setShowSendModal(false)}>
            <div style={{background:"rgba(0,0,0,0.98)",borderRadius:"24px 24px 0 0",padding:"28px 24px 44px",width:"100%",maxWidth:430,border:"1px solid rgba(59,130,246,0.2)",animation:"floatUp 0.3s ease forwards"}}
              onClick={e=>e.stopPropagation()}>
              <p style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:24,fontWeight:300,marginBottom:20}}>
                Send <em style={{color:"#60A5FA"}}>funds</em>
              </p>

              {/* Token selector */}
              <p style={{...S.cardEyebrow,marginBottom:10}}>Token</p>
              <div style={{display:"flex",gap:10,marginBottom:16}}>
                {["SUI","USDC"].map(t=>(
                  <button key={t} style={{flex:1,padding:"12px",borderRadius:12,cursor:"pointer",
                    fontFamily:"'DM Sans',sans-serif",fontSize:14,fontWeight:600,
                    background:sendToken===t?"rgba(59,130,246,0.2)":"rgba(0,0,0,0.8)",
                    border:sendToken===t?"1px solid rgba(59,130,246,0.5)":"1px solid rgba(59,130,246,0.1)",
                    color:sendToken===t?"#60A5FA":"rgba(148,163,184,0.5)"}}
                    onClick={()=>setSendToken(t)}>{t}
                  </button>
                ))}
              </div>

              <p style={{...S.cardEyebrow,marginBottom:10}}>Amount</p>
              <div style={{position:"relative",marginBottom:16}}>
                <input style={{...S.input,borderColor:"rgba(59,130,246,0.2)",paddingRight:70}} type="number"
                  placeholder="0.00" value={sendAmount} onChange={e=>setSendAmount(e.target.value)}/>
                <span style={{position:"absolute",right:16,top:"50%",transform:"translateY(-50%)",
                  fontFamily:"'DM Sans',sans-serif",color:"rgba(96,165,250,0.6)",fontSize:12,fontWeight:600}}>
                  {sendToken} · bal: {sendToken==="SUI"?walletBalances.sui:walletBalances.usdc}
                </span>
              </div>

              <p style={{...S.cardEyebrow,marginBottom:10}}>Recipient address</p>
              <input style={{...S.input,marginBottom:16,borderColor:"rgba(59,130,246,0.2)"}}
                placeholder="0x…" value={sendAddress} onChange={e=>setSendAddress(e.target.value)}/>

              <p style={{...S.cardEyebrow,marginBottom:10}}>Note (optional)</p>
              <input style={{...S.input,marginBottom:20,borderColor:"rgba(59,130,246,0.2)"}}
                placeholder="e.g. Savings contribution" value={sendNote} onChange={e=>setSendNote(e.target.value)}/>

              <button style={{...S.primaryBtn,
                background:"linear-gradient(135deg,#1D4ED8,#3B82F6)",
                boxShadow:"0 6px 24px rgba(59,130,246,0.4)",
                opacity:parseFloat(sendAmount)>0&&sendAddress.trim()?1:0.4}}
                onClick={handleSend}>
                Send {sendAmount||"0"} {sendToken} →
              </button>
              <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(96,165,250,0.3)",fontSize:11,textAlign:"center",marginTop:10}}>
                Gas sponsored by Enoki · No fees on transfers
              </p>
            </div>
          </div>
        )}

        {/* Receive Modal */}
        {showReceiveModal && (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:300,display:"flex",alignItems:"flex-end",justifyContent:"center"}}
            onClick={()=>setShowReceiveModal(false)}>
            <div style={{background:"rgba(0,0,0,0.98)",borderRadius:"24px 24px 0 0",padding:"28px 24px 44px",width:"100%",maxWidth:430,border:"1px solid rgba(59,130,246,0.2)",animation:"floatUp 0.3s ease forwards"}}
              onClick={e=>e.stopPropagation()}>
              <p style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:24,fontWeight:300,marginBottom:6}}>
                Receive <em style={{color:"#60A5FA"}}>funds</em>
              </p>
              <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(148,163,184,0.5)",fontSize:13,marginBottom:24,fontWeight:300}}>
                Share your address to receive SUI or USDC
              </p>

              {/* QR placeholder */}
              <div style={{width:160,height:160,margin:"0 auto 20px",borderRadius:16,
                background:"rgba(59,130,246,0.08)",border:"2px solid rgba(59,130,246,0.2)",
                display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8}}>
                <span style={{fontSize:48}}>⬛</span>
                <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(96,165,250,0.4)",fontSize:10}}>QR Code</p>
              </div>

              {/* Address display */}
              <div style={{background:"rgba(59,130,246,0.06)",borderRadius:14,padding:"14px 16px",
                border:"1px solid rgba(59,130,246,0.15)",marginBottom:16,display:"flex",alignItems:"center",gap:10}}>
                <p style={{fontFamily:"'DM Sans',sans-serif",color:"#94A3B8",fontSize:12,flex:1,wordBreak:"break-all",lineHeight:1.6,margin:0}}>
                  {myAddress}
                </p>
                <button style={{background:"rgba(59,130,246,0.15)",border:"1px solid rgba(59,130,246,0.3)",
                  borderRadius:10,padding:"8px 12px",cursor:"pointer",
                  fontFamily:"'DM Sans',sans-serif",color:walletCopied?"#34D399":"#60A5FA",fontSize:11,fontWeight:600,flexShrink:0}}
                  onClick={copyWalletAddress}>
                  {walletCopied?"Copied ✓":"Copy"}
                </button>
              </div>

              <div style={{background:"rgba(59,130,246,0.05)",borderRadius:12,padding:"12px 14px",border:"1px solid rgba(59,130,246,0.1)"}}>
                <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(96,165,250,0.5)",fontSize:11,margin:0,lineHeight:1.6}}>
                  ⚡ This is your zkLogin Sui address — derived from your Google account.<br/>
                  Anyone can send SUI or USDC to this address.
                </p>
              </div>
            </div>
          </div>
        )}

        <div style={{padding:"52px 22px 110px",position:"relative",zIndex:1}}>
          {/* Header */}
          <div className="f1" style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
            <div>
              <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(148,163,184,0.5)",fontSize:13,fontWeight:300}}>Your wallet,</p>
              <p style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:26,fontWeight:300}}>
                {displayName} <em style={{color:"#60A5FA"}}>💳</em>
              </p>
            </div>
            {zkUser?.picture
              ? <img src={zkUser.picture} alt="" style={{width:42,height:42,borderRadius:"50%",border:"2px solid rgba(59,130,246,0.4)",boxShadow:"0 0 16px rgba(59,130,246,0.3)"}}/>
              : <div style={{width:42,height:42,borderRadius:"50%",background:"linear-gradient(135deg,#1D4ED8,#3B82F6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,color:"#fff",fontWeight:700,fontFamily:"'DM Sans',sans-serif"}}>{displayName[0]}</div>
            }
          </div>

          {/* Balance card */}
          <div className="f2" style={{
            background:"linear-gradient(145deg,rgba(29,78,216,0.25),rgba(59,130,246,0.15),rgba(0,0,0,0.7))",
            borderRadius:28,padding:"28px 22px",
            border:"1px solid rgba(59,130,246,0.2)",
            boxShadow:"0 12px 48px rgba(29,78,216,0.25)",
            marginBottom:16,
          }}>
            <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(148,163,184,0.5)",fontSize:12,fontWeight:300,marginBottom:16,letterSpacing:1,textTransform:"uppercase"}}>Total Balance</p>

            {/* SUI balance */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,
              paddingBottom:12,borderBottom:"1px solid rgba(59,130,246,0.1)"}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:36,height:36,borderRadius:10,background:"rgba(59,130,246,0.15)",border:"1px solid rgba(59,130,246,0.25)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>◈</div>
                <div>
                  <p style={{fontFamily:"'DM Sans',sans-serif",color:"#94A3B8",fontSize:11,margin:0}}>SUI</p>
                  <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(148,163,184,0.4)",fontSize:10,margin:0}}>Sui Network</p>
                </div>
              </div>
              <p style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:24,fontWeight:400,margin:0}}>
                {walletBalances.sui.toFixed(4)}
              </p>
            </div>

            {/* USDC balance */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:36,height:36,borderRadius:10,background:"rgba(16,185,129,0.12)",border:"1px solid rgba(16,185,129,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:"#34D399",fontFamily:"'DM Sans',sans-serif"}}>$</div>
                <div>
                  <p style={{fontFamily:"'DM Sans',sans-serif",color:"#94A3B8",fontSize:11,margin:0}}>USDC</p>
                  <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(148,163,184,0.4)",fontSize:10,margin:0}}>USD Coin</p>
                </div>
              </div>
              <p style={{fontFamily:"'Cormorant Garamond',serif",color:"#FFFFFF",fontSize:24,fontWeight:400,margin:0}}>
                {walletBalances.usdc.toFixed(2)}
              </p>
            </div>

            {/* Address strip */}
            <div style={{marginTop:16,paddingTop:14,borderTop:"1px solid rgba(59,130,246,0.08)",
              display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(148,163,184,0.4)",fontSize:11,margin:0}}>
                {shortAddr(myAddress)}
              </p>
              <button style={{background:"none",border:"none",cursor:"pointer",
                fontFamily:"'DM Sans',sans-serif",color:walletCopied?"#34D399":"rgba(96,165,250,0.5)",fontSize:11,padding:0}}
                onClick={copyWalletAddress}>
                {walletCopied?"Copied ✓":"Copy address"}
              </button>
            </div>
          </div>

          {/* Send / Receive buttons */}
          <div className="f3" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:24}}>
            <button style={{padding:"16px",borderRadius:18,cursor:"pointer",
              background:"linear-gradient(135deg,#1D4ED8,#3B82F6)",border:"none",
              fontFamily:"'DM Sans',sans-serif",color:"#fff",fontSize:15,fontWeight:600,
              boxShadow:"0 6px 20px rgba(59,130,246,0.4)",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}
              onClick={()=>setShowSendModal(true)}>
              ↑ Send
            </button>
            <button style={{padding:"16px",borderRadius:18,cursor:"pointer",
              background:"rgba(59,130,246,0.1)",border:"1px solid rgba(59,130,246,0.3)",
              fontFamily:"'DM Sans',sans-serif",color:"#60A5FA",fontSize:15,fontWeight:600,
              display:"flex",alignItems:"center",justifyContent:"center",gap:8}}
              onClick={()=>setShowReceiveModal(true)}>
              ↓ Receive
            </button>
          </div>

          {/* Recent transactions */}
          <p style={S.sectionLabel}>Recent Transactions</p>
          <div className="f4">
            {walletTxns.length === 0 && (
              <div style={{textAlign:"center",padding:"32px 0"}}>
                <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(148,163,184,0.3)",fontSize:13}}>No transactions yet</p>
              </div>
            )}
            {walletTxns.map((tx,i)=>(
              <div key={tx.id} style={{
                display:"flex",alignItems:"center",gap:12,
                background:"rgba(0,0,0,0.7)",borderRadius:16,padding:"14px 16px",marginBottom:8,
                border:"1px solid rgba(59,130,246,0.08)",
              }}>
                {/* Icon */}
                <div style={{width:40,height:40,borderRadius:12,flexShrink:0,
                  background:tx.type==="received"?"rgba(16,185,129,0.12)":"rgba(239,68,68,0.1)",
                  border:tx.type==="received"?"1px solid rgba(16,185,129,0.2)":"1px solid rgba(239,68,68,0.15)",
                  display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>
                  {tx.type==="received"?"↓":"↑"}
                </div>

                {/* Details */}
                <div style={{flex:1,minWidth:0}}>
                  <p style={{fontFamily:"'DM Sans',sans-serif",color:"#FFFFFF",fontSize:13,fontWeight:500,margin:0,
                    overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {tx.note || (tx.type==="received"?`From ${tx.from}`:`To ${tx.to}`)}
                  </p>
                  <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(148,163,184,0.4)",fontSize:11,margin:"3px 0 0"}}>
                    {tx.date} · {tx.type==="received"
                      ? shortAddr(tx.from||"")
                      : shortAddr(tx.to||"")}
                  </p>
                </div>

                {/* Amount */}
                <p style={{fontFamily:"'Cormorant Garamond',serif",
                  color:tx.type==="received"?"#34D399":"#F87171",
                  fontSize:17,fontWeight:400,margin:0,flexShrink:0}}>
                  {tx.type==="received"?"+":"-"}{tx.amount} {tx.token}
                </p>
              </div>
            ))}
          </div>

          {/* zkLogin info strip */}
          <div style={{textAlign:"center",padding:"14px",border:"1px solid rgba(59,130,246,0.07)",borderRadius:14,marginTop:8}}>
            <p style={{fontFamily:"'DM Sans',sans-serif",color:"rgba(96,165,250,0.25)",fontSize:11}}>
              ⚡ zkLogin wallet · Gas sponsored · Derived from your Google account
            </p>
          </div>
        </div>

        <BottomNav activeTab="wallet" setActiveTab={setActiveTab} goTo={goTo}/>
      </div>
    );
  }

  return null;
}
