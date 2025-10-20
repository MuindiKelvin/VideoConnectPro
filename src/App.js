import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import { getDatabase, ref, set, onValue, update, remove, push, serverTimestamp, get } from 'firebase/database';
import 'bootstrap/dist/css/bootstrap.min.css';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyB2WSi5nz4qq2-Fj359JUgLXmkZvA25TJY",
  authDomain: "video-conferencing-app-e397d.firebaseapp.com",
  databaseURL: "https://video-conferencing-app-e397d-default-rtdb.firebaseio.com",
  projectId: "video-conferencing-app-e397d",
  storageBucket: "video-conferencing-app-e397d.firebasestorage.app",
  messagingSenderId: "659924095179",
  appId: "1:659924095179:web:23565b1a492863ca290b4e",
  measurementId: "G-SM51EF486Q"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);
const googleProvider = new GoogleAuthProvider();

// ICE Servers for WebRTC
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ]
};

const VideoConference = () => {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [currentView, setCurrentView] = useState('home');
  const [meetingId, setMeetingId] = useState('');
  const [activeMeeting, setActiveMeeting] = useState(null);
  const [participants, setParticipants] = useState({});
  const [waitingRoom, setWaitingRoom] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [bellRequests, setBellRequests] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [showReactions, setShowReactions] = useState(false);
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [polls, setPolls] = useState([]);
  const [showPollCreator, setShowPollCreator] = useState(false);
  const [meetingNotes, setMeetingNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [userStats, setUserStats] = useState({ meetingsHosted: 0, meetingsJoined: 0, totalMinutes: 0 });
  const [showMediaPreview, setShowMediaPreview] = useState(false);
  const [previewVideoEnabled, setPreviewVideoEnabled] = useState(true);
  const [previewAudioEnabled, setPreviewAudioEnabled] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(25);
  const [isDragging, setIsDragging] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [generatedMeetingLink, setGeneratedMeetingLink] = useState('');
  
  const localVideoRef = useRef(null);
  const previewVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const previewStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const meetingStartTimeRef = useRef(null);
  const admissionListenerRef = useRef(null);
  
  // WebRTC Refs
  const peerConnectionsRef = useRef({});
  const remoteStreamsRef = useRef({});
  const remoteVideoRefsRef = useRef({});

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        await createOrUpdateUserProfile(currentUser);
        await loadUserStats(currentUser.uid);
      } else {
        setCurrentView('home');
        setUserProfile(null);
      }
    });
    return () => unsubscribe();
  }, []);

  const createOrUpdateUserProfile = async (user) => {
    try {
      const userRef = ref(database, `users/${user.uid}`);
      const snapshot = await get(userRef);
      
      const profileData = {
        uid: user.uid,
        displayName: user.displayName || 'Anonymous User',
        email: user.email,
        photoURL: user.photoURL || 'https://via.placeholder.com/150',
        lastLogin: serverTimestamp(),
        accountCreated: snapshot.exists() ? snapshot.val().accountCreated : serverTimestamp(),
        bio: snapshot.exists() ? snapshot.val().bio : 'Hey there! I\'m using VideoConnect Pro 🎥'
      };
      
      await set(userRef, profileData);
      setUserProfile(profileData);
    } catch (error) {
      console.error('Error creating profile:', error);
      setUserProfile({
        uid: user.uid,
        displayName: user.displayName || 'Anonymous User',
        email: user.email,
        photoURL: user.photoURL || 'https://via.placeholder.com/150',
        bio: 'Hey there! I\'m using VideoConnect Pro 🎥'
      });
    }
  };

  const loadUserStats = async (userId) => {
    try {
      const statsRef = ref(database, `userStats/${userId}`);
      const snapshot = await get(statsRef);
      if (snapshot.exists()) {
        setUserStats(snapshot.val());
      } else {
        setUserStats({ meetingsHosted: 0, meetingsJoined: 0, totalMinutes: 0 });
      }
    } catch (error) {
      console.error('Error loading stats:', error);
      setUserStats({ meetingsHosted: 0, meetingsJoined: 0, totalMinutes: 0 });
    }
  };

  const updateUserStats = async (type) => {
    if (!user) return;
    
    try {
      const statsRef = ref(database, `userStats/${user.uid}`);
      const snapshot = await get(statsRef);
      const currentStats = snapshot.exists() ? snapshot.val() : { meetingsHosted: 0, meetingsJoined: 0, totalMinutes: 0 };
      
      if (type === 'host') {
        currentStats.meetingsHosted = (currentStats.meetingsHosted || 0) + 1;
      } else if (type === 'join') {
        currentStats.meetingsJoined = (currentStats.meetingsJoined || 0) + 1;
      }
      
      await set(statsRef, currentStats);
      setUserStats(currentStats);
    } catch (error) {
      console.error('Error updating stats:', error);
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      googleProvider.setCustomParameters({
        prompt: 'select_account'
      });
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      alert('Sign in failed: ' + error.message);
    }
  };

  const handleSignOut = async () => {
    try {
      if (activeMeeting) {
        await leaveMeeting();
      }
      await signOut(auth);
    } catch (error) {
      alert('Sign out failed: ' + error.message);
    }
  };

  const createMeeting = async () => {
    if (!user) return;
    
    try {
      const meetingRef = push(ref(database, 'meetings'));
      const newMeetingId = meetingRef.key;
      const expiryTime = Date.now() + (2 * 60 * 60 * 1000);
      
      await set(meetingRef, {
        hostId: user.uid,
        hostName: user.displayName,
        hostPhoto: user.photoURL,
        createdAt: serverTimestamp(),
        expiryTime: expiryTime,
        status: 'active',
        participants: {},
        waitingRoom: {},
        signals: {}
      });

      await updateUserStats('host');
      setMeetingId(newMeetingId);
      
      const meetingLink = `${window.location.origin}?meeting=${newMeetingId}`;
      setGeneratedMeetingLink(meetingLink);
      setShowShareModal(true);
    } catch (error) {
      console.error('Error creating meeting:', error);
      alert('Failed to create meeting. Please check your Firebase permissions.');
    }
  };

  const shareOnPlatform = (platform) => {
    const meetingLink = generatedMeetingLink;
    const meetingText = `Join my VideoConnect Pro meeting!\nMeeting Link: ${meetingLink}`;
    
    let shareUrl = '';
    
    switch(platform) {
      case 'whatsapp':
        shareUrl = `https://wa.me/?text=${encodeURIComponent(meetingText)}`;
        break;
      case 'telegram':
        shareUrl = `https://t.me/share/url?url=${encodeURIComponent(meetingLink)}&text=${encodeURIComponent('Join my VideoConnect Pro meeting!')}`;
        break;
      case 'email':
        shareUrl = `mailto:?subject=Join My Meeting&body=${encodeURIComponent(meetingText)}`;
        break;
      case 'copy':
        navigator.clipboard.writeText(meetingLink);
        alert('Meeting link copied to clipboard! 📋');
        return;
      default:
        break;
    }
    
    if (shareUrl) {
      window.open(shareUrl, '_blank');
    }
  };

  const startMediaPreview = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: previewVideoEnabled, 
        audio: previewAudioEnabled
      });
      previewStreamRef.current = stream;
      if (previewVideoRef.current && previewVideoEnabled) {
        previewVideoRef.current.srcObject = stream;
      }
    } catch (error) {
      alert('Cannot access camera/microphone: ' + error.message);
    }
  };

  const togglePreviewVideo = () => {
    const newState = !previewVideoEnabled;
    setPreviewVideoEnabled(newState);
    if (previewStreamRef.current) {
      const videoTrack = previewStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = newState;
      }
    }
  };

  const togglePreviewAudio = () => {
    const newState = !previewAudioEnabled;
    setPreviewAudioEnabled(newState);
    if (previewStreamRef.current) {
      const audioTrack = previewStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = newState;
      }
    }
  };

  const joinMeeting = async (id) => {
    if (!user) {
      alert('Please sign in first');
      return;
    }

    try {
      const meetingRef = ref(database, `meetings/${id}`);
      const snapshot = await get(meetingRef);
      
      if (!snapshot.exists()) {
        alert('Meeting not found ❌');
        return;
      }

      const meetingData = snapshot.val();
      
      if (meetingData.expiryTime < Date.now()) {
        alert('This meeting has expired ⏰');
        return;
      }

      setMeetingId(id);
      setShowMediaPreview(true);
      await startMediaPreview();
    } catch (error) {
      console.error('Error joining meeting:', error);
      alert('Failed to join meeting: ' + error.message);
    }
  };

  const proceedToMeeting = async () => {
    setShowMediaPreview(false);
    
    if (previewStreamRef.current) {
      previewStreamRef.current.getTracks().forEach(track => track.stop());
    }

    const meetingRef = ref(database, `meetings/${meetingId}`);
    const snapshot = await get(meetingRef);
    const meetingData = snapshot.val();

    if (meetingData.hostId === user.uid) {
      await joinAsHost(meetingId);
    } else {
      await requestToJoin(meetingId);
    }
  };

  const requestToJoin = async (id) => {
    try {
      const waitingRef = ref(database, `meetings/${id}/waitingRoom/${user.uid}`);
      await set(waitingRef, {
        userId: user.uid,
        userName: user.displayName,
        userEmail: user.email,
        userPhoto: user.photoURL,
        requestTime: serverTimestamp()
      });

      setCurrentView('waiting');
      
      const participantRef = ref(database, `meetings/${id}/participants/${user.uid}`);
      admissionListenerRef.current = onValue(participantRef, async (snapshot) => {
        if (snapshot.exists()) {
          if (admissionListenerRef.current) {
            admissionListenerRef.current();
            admissionListenerRef.current = null;
          }
          await initializeMedia();
          setCurrentView('meeting');
          meetingStartTimeRef.current = Date.now();
          setActiveMeeting({ id, isHost: false });
          listenToMeetingUpdates(id);
          setupWebRTC(id);
          await updateUserStats('join');
        }
      });
    } catch (error) {
      console.error('Error requesting to join:', error);
      alert('Failed to join waiting room: ' + error.message);
    }
  };

  const joinAsHost = async (id) => {
    try {
      await initializeMedia();
      setCurrentView('meeting');
      meetingStartTimeRef.current = Date.now();
      
      const participantRef = ref(database, `meetings/${id}/participants/${user.uid}`);
      await set(participantRef, {
        userId: user.uid,
        userName: user.displayName,
        userPhoto: user.photoURL,
        userEmail: user.email,
        isHost: true,
        videoEnabled: previewVideoEnabled,
        audioEnabled: previewAudioEnabled,
        joinedAt: serverTimestamp(),
        handRaised: false
      });

      setActiveMeeting({ id, isHost: true });
      listenToMeetingUpdates(id);
      setupWebRTC(id);
    } catch (error) {
      console.error('Error joining as host:', error);
      alert('Failed to join as host: ' + error.message);
    }
  };

    const setupWebRTC = (meetingId) => {
      console.log('Setting up WebRTC for meeting:', meetingId);
      
      const signalsRef = ref(database, `meetings/${meetingId}/signals`);
      
      onValue(signalsRef, async (snapshot) => {
        const signals = snapshot.val();
        if (!signals) return;

        for (const [signalId, signal] of Object.entries(signals)) {
          if (signal.to === user.uid && signal.from !== user.uid) {
            console.log(`Processing signal from ${signal.from}, type: ${signal.type}`);
            try {
              if (signal.type === 'offer') {
                await handleOffer(meetingId, signal.from, signal.offer);
              } else if (signal.type === 'answer') {
                await handleAnswer(signal.from, signal.answer);
              } else if (signal.type === 'ice-candidate') {
                await handleIceCandidate(signal.from, signal.candidate);
              }
              
              await remove(ref(database, `meetings/${meetingId}/signals/${signalId}`));
            } catch (error) {
              console.error('Error processing signal:', error);
              await remove(ref(database, `meetings/${meetingId}/signals/${signalId}`));
            }
          }
        }
      });

      const participantsRef = ref(database, `meetings/${meetingId}/participants`);
      onValue(participantsRef, async (snapshot) => {
        const participants = snapshot.val();
        if (!participants) {
          console.log('No participants in meeting');
          return;
        }

        console.log('Participants updated:', Object.keys(participants));

        // Create connections for new participants
        for (const participantId of Object.keys(participants)) {
          if (participantId !== user.uid && !peerConnectionsRef.current[participantId]) {
            console.log(`New participant detected: ${participantId}, creating peer connection`);
            try {
              // Delay to ensure both peers are ready
              await new Promise(resolve => setTimeout(resolve, 500));
              await createPeerConnection(meetingId, participantId, true);
            } catch (error) {
              console.error('Error creating peer connection:', error);
            }
          }
        }
        
        // Clean up connections for left participants
        for (const existingPeerId of Object.keys(peerConnectionsRef.current)) {
          if (!participants[existingPeerId]) {
            console.log(`Participant left: ${existingPeerId}, cleaning up`);
            peerConnectionsRef.current[existingPeerId].close();
            delete peerConnectionsRef.current[existingPeerId];
            delete remoteStreamsRef.current[existingPeerId];
            setParticipants(prev => {
              const updated = { ...prev };
              delete updated[existingPeerId];
              return updated;
            });
          }
        }
      });
    };

  const createPeerConnection = async (meetingId, remoteUserId, shouldCreateOffer) => {
    const peerConnection = new RTCPeerConnection(iceServers);
    peerConnectionsRef.current[remoteUserId] = peerConnection;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStreamRef.current);
      });
    }

    peerConnection.ontrack = (event) => {
      remoteStreamsRef.current[remoteUserId] = event.streams[0];
      setParticipants(prev => ({ ...prev }));
    };

    peerConnection.onicecandidate = async (event) => {
      if (event.candidate) {
        const signalRef = push(ref(database, `meetings/${meetingId}/signals`));
        await set(signalRef, {
          type: 'ice-candidate',
          candidate: event.candidate.toJSON(),
          from: user.uid,
          to: remoteUserId,
          timestamp: serverTimestamp()
        });
      }
    };

    if (shouldCreateOffer) {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      const signalRef = push(ref(database, `meetings/${meetingId}/signals`));
      await set(signalRef, {
        type: 'offer',
        offer: {
          type: offer.type,
          sdp: offer.sdp
        },
        from: user.uid,
        to: remoteUserId,
        timestamp: serverTimestamp()
      });
    }

    return peerConnection;
  };

  const handleOffer = async (meetingId, remoteUserId, offer) => {
    let peerConnection = peerConnectionsRef.current[remoteUserId];
    
    if (!peerConnection) {
      peerConnection = await createPeerConnection(meetingId, remoteUserId, false);
    }

    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    const signalRef = push(ref(database, `meetings/${meetingId}/signals`));
    await set(signalRef, {
      type: 'answer',
      answer: {
        type: answer.type,
        sdp: answer.sdp
      },
      from: user.uid,
      to: remoteUserId,
      timestamp: serverTimestamp()
    });
  };

  const handleAnswer = async (remoteUserId, answer) => {
    const peerConnection = peerConnectionsRef.current[remoteUserId];
    if (peerConnection) {
      await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
    }
  };

  const handleIceCandidate = async (remoteUserId, candidate) => {
    const peerConnection = peerConnectionsRef.current[remoteUserId];
    if (peerConnection) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  };

  const admitParticipant = async (participantId, participantData) => {
    try {
      const participantRef = ref(database, `meetings/${meetingId}/participants/${participantId}`);
      await set(participantRef, {
        userId: participantData.userId,
        userName: participantData.userName,
        userEmail: participantData.userEmail,
        userPhoto: participantData.userPhoto,
        isHost: false,
        videoEnabled: true,
        audioEnabled: true,
        admittedAt: serverTimestamp(),
        handRaised: false
      });

      const waitingRef = ref(database, `meetings/${meetingId}/waitingRoom/${participantId}`);
      await remove(waitingRef);
    } catch (error) {
      console.error('Error admitting participant:', error);
    }
  };

  const rejectParticipant = async (participantId) => {
    try {
      const waitingRef = ref(database, `meetings/${meetingId}/waitingRoom/${participantId}`);
      await remove(waitingRef);
    } catch (error) {
      console.error('Error rejecting participant:', error);
    }
  };

  const initializeMedia = async () => {
    try {
      const constraints = {
        video: previewVideoEnabled ? { width: 1280, height: 720 } : false,
        audio: previewAudioEnabled ? { echoCancellation: true, noiseSuppression: true } : false
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      
      if (localVideoRef.current && previewVideoEnabled) {
        localVideoRef.current.srcObject = stream;
      }
      
      setIsVideoOff(!previewVideoEnabled);
      setIsMuted(!previewAudioEnabled);
    } catch (error) {
      console.error('Media initialization error:', error);
      alert('Cannot access camera/microphone: ' + error.message);
    }
  };

  const listenToMeetingUpdates = (id) => {
    const waitingRoomRef = ref(database, `meetings/${id}/waitingRoom`);
    onValue(waitingRoomRef, (snapshot) => {
      const data = snapshot.val();
      setWaitingRoom(data ? Object.entries(data).map(([key, val]) => ({ id: key, ...val })) : []);
    });

    const participantsRef = ref(database, `meetings/${id}/participants`);
    onValue(participantsRef, (snapshot) => {
      const data = snapshot.val();
      setParticipants(data || {});
    });

    const bellRequestsRef = ref(database, `meetings/${id}/bellRequests`);
    onValue(bellRequestsRef, (snapshot) => {
      const data = snapshot.val();
      setBellRequests(data ? Object.entries(data).map(([key, val]) => ({ id: key, ...val })) : []);
    });

    const chatRef = ref(database, `meetings/${id}/chat`);
    onValue(chatRef, (snapshot) => {
      const data = snapshot.val();
      setChatMessages(data ? Object.entries(data).map(([key, val]) => ({ id: key, ...val })) : []);
    });

    const pollsRef = ref(database, `meetings/${id}/polls`);
    onValue(pollsRef, (snapshot) => {
      const data = snapshot.val();
      setPolls(data ? Object.entries(data).map(([key, val]) => ({ id: key, ...val })) : []);
    });

    const notesRef = ref(database, `meetings/${id}/notes`);
    onValue(notesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) setMeetingNotes(data.content || '');
    });
  };

  const toggleRaiseHand = async () => {
    if (!activeMeeting) return;
    
    const newState = !isHandRaised;
    setIsHandRaised(newState);
    
    try {
      const participantRef = ref(database, `meetings/${meetingId}/participants/${user.uid}`);
      await update(participantRef, { handRaised: newState });
    } catch (error) {
      console.error('Error toggling hand:', error);
    }
  };

  const requestToSpeak = async () => {
    if (!activeMeeting) return;
    
    try {
      const bellRef = push(ref(database, `meetings/${meetingId}/bellRequests`));
      await set(bellRef, {
        userId: user.uid,
        userName: user.displayName,
        userPhoto: user.photoURL,
        requestTime: serverTimestamp()
      });
    } catch (error) {
      console.error('Error requesting to speak:', error);
    }
  };

  const approveSpeakRequest = async (requestId) => {
    try {
      const bellRef = ref(database, `meetings/${meetingId}/bellRequests/${requestId}`);
      await remove(bellRef);
    } catch (error) {
      console.error('Error approving speak request:', error);
    }
  };

  const toggleScreenShare = async () => {
    try {
      if (!isScreenSharing) {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
          video: { cursor: "always" },
          audio: true
        });
        screenStreamRef.current = screenStream;
        
        const screenTrack = screenStream.getVideoTracks()[0];
        
        for (const peerConnection of Object.values(peerConnectionsRef.current)) {
          const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
          if (sender) {
            sender.replaceTrack(screenTrack);
          }
        }
        
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream;
        }
        
        screenTrack.onended = () => {
          stopScreenShare();
        };
        
        setIsScreenSharing(true);
      } else {
        stopScreenShare();
      }
    } catch (error) {
      alert('Screen sharing failed: ' + error.message);
    }
  };

  const stopScreenShare = () => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      
      for (const peerConnection of Object.values(peerConnectionsRef.current)) {
        const sender = peerConnection.getSenders().find(s => s.track?.kind === 'video');
        if (sender && videoTrack) {
          sender.replaceTrack(videoTrack);
        }
      }
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
    }
    
    setIsScreenSharing(false);
  };

  const toggleRecording = async () => {
    if (!isRecording) {
      startRecording();
    } else {
      stopRecording();
    }
  };

  const startRecording = () => {
    if (!localStreamRef.current) return;
    
    try {
      const options = { mimeType: 'video/webm;codecs=vp9' };
      mediaRecorderRef.current = new MediaRecorder(localStreamRef.current, options);
      recordedChunksRef.current = [];
      
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `meeting-${meetingId}-${Date.now()}.webm`;
        a.click();
      };
      
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (error) {
      alert('Recording failed: ' + error.message);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
        
        if (activeMeeting) {
          const participantRef = ref(database, `meetings/${meetingId}/participants/${user.uid}`);
          update(participantRef, { audioEnabled: audioTrack.enabled });
        }
      }
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
        
        if (activeMeeting) {
          const participantRef = ref(database, `meetings/${meetingId}/participants/${user.uid}`);
          update(participantRef, { videoEnabled: videoTrack.enabled });
        }
      }
    }
  };

  const sendMessage = async () => {
    if (!messageInput.trim() || !activeMeeting) return;
    
    try {
      const chatRef = push(ref(database, `meetings/${meetingId}/chat`));
      await set(chatRef, {
        userId: user.uid,
        userName: user.displayName,
        userPhoto: user.photoURL,
        message: messageInput,
        timestamp: serverTimestamp()
      });
      
      setMessageInput('');
    } catch (error) {
      console.error('Error sending message:', error);
    }
  };

  const sendReaction = async (emoji) => {
    if (!activeMeeting) return;
    
    try {
      const reactionRef = push(ref(database, `meetings/${meetingId}/reactions`));
      await set(reactionRef, {
        userId: user.uid,
        userName: user.displayName,
        emoji: emoji,
        timestamp: serverTimestamp()
      });
      
      setTimeout(async () => {
        await remove(reactionRef);
      }, 3000);
    } catch (error) {
      console.error('Error sending reaction:', error);
    }
  };

  const createPoll = async (question, options) => {
    if (!activeMeeting || !question || options.length < 2) return;
    
    try {
      const pollRef = push(ref(database, `meetings/${meetingId}/polls`));
      await set(pollRef, {
        question,
        options: options.map(opt => ({ text: opt, votes: 0, voters: [] })),
        createdBy: user.uid,
        createdAt: serverTimestamp(),
        active: true
      });
      
      setShowPollCreator(false);
    } catch (error) {
      console.error('Error creating poll:', error);
    }
  };

  const votePoll = async (pollId, optionIndex) => {
    if (!activeMeeting) return;
    
    try {
      const pollRef = ref(database, `meetings/${meetingId}/polls/${pollId}`);
      const snapshot = await get(pollRef);
      const pollData = snapshot.val();
      
      const hasVoted = pollData.options.some(opt => opt.voters && opt.voters.includes(user.uid));
      if (hasVoted) return;
      
      pollData.options[optionIndex].votes += 1;
      pollData.options[optionIndex].voters = [...(pollData.options[optionIndex].voters || []), user.uid];
      
      await set(pollRef, pollData);
    } catch (error) {
      console.error('Error voting on poll:', error);
    }
  };

  const saveMeetingNotes = async () => {
    if (!activeMeeting) return;
    
    try {
      const notesRef = ref(database, `meetings/${meetingId}/notes`);
      await set(notesRef, {
        content: meetingNotes,
        lastUpdated: serverTimestamp(),
        updatedBy: user.displayName
      });
    } catch (error) {
      console.error('Error saving notes:', error);
    }
  };

  const leaveMeeting = async () => {
    if (admissionListenerRef.current) {
      admissionListenerRef.current();
      admissionListenerRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
    }
    
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
    }
    
    Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
    peerConnectionsRef.current = {};
    remoteStreamsRef.current = {};
    
    if (meetingStartTimeRef.current && user) {
      const duration = Math.floor((Date.now() - meetingStartTimeRef.current) / 60000);
      const statsRef = ref(database, `userStats/${user.uid}`);
      const snapshot = await get(statsRef);
      const currentStats = snapshot.exists() ? snapshot.val() : { totalMinutes: 0 };
      currentStats.totalMinutes = (currentStats.totalMinutes || 0) + duration;
      await set(statsRef, currentStats);
    }
    
    if (activeMeeting) {
      try {
        const participantRef = ref(database, `meetings/${meetingId}/participants/${user.uid}`);
        await remove(participantRef);
      } catch (error) {
        console.error('Error leaving meeting:', error);
      }
    }
    
    setActiveMeeting(null);
    setCurrentView('home');
    setMeetingId('');
  };

  const handleMouseDown = (e) => {
    setIsDragging(true);
    e.preventDefault();
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    
    const newWidth = (e.clientX / window.innerWidth) * 100;
    if (newWidth >= 20 && newWidth <= 40) {
      setSidebarWidth(100 - newWidth);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const meetingParam = params.get('meeting');
    if (meetingParam && user) {
      setMeetingId(meetingParam);
      joinMeeting(meetingParam);
    }
  }, [user]);

  const renderHome = () => (
    <div className="container mt-5 mb-5">
      <div className="row justify-content-center">
        <div className="col-md-10">
          {/* Main Card with Gradient Header */}
          <div className="card shadow-lg border-0 mb-4 overflow-hidden">
            {/* Gradient Header Banner */}
            <div style={{
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              padding: '3rem 2rem',
              position: 'relative',
              overflow: 'hidden'
            }}>
              <div style={{
                position: 'absolute',
                top: '-50px',
                right: '-50px',
                width: '200px',
                height: '200px',
                background: 'rgba(255,255,255,0.1)',
                borderRadius: '50%'
              }}></div>
              <div style={{
                position: 'absolute',
                bottom: '-30px',
                left: '-30px',
                width: '150px',
                height: '150px',
                background: 'rgba(255,255,255,0.1)',
                borderRadius: '50%'
              }}></div>
              <div className="text-center position-relative" style={{ zIndex: 1 }}>
                <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🎥</div>
                <h1 className="display-3 text-white fw-bold mb-2">VideoConnect Pro</h1>
                <p className="text-white-50 fs-5 mb-0">
                  <i className="bi bi-lightning-charge-fill me-2"></i>
                  Connect instantly, collaborate seamlessly
                </p>
              </div>
            </div>

            <div className="card-body p-5">
              {!user ? (
                <div className="text-center py-5">
                  <div className="mb-4">
                    <div style={{
                      display: 'inline-block',
                      padding: '2rem',
                      background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
                      borderRadius: '50%',
                      marginBottom: '2rem'
                    }}>
                      <i className="bi bi-shield-lock-fill text-white" style={{ fontSize: '3rem' }}></i>
                    </div>
                  </div>
                  <h3 className="mb-3">🚀 Ready to Get Started?</h3>
                  <p className="text-muted mb-4 fs-5">Sign in securely with your Google account</p>
                  <button 
                    onClick={handleGoogleSignIn} 
                    className="btn btn-lg px-5 py-3 shadow-sm"
                    style={{
                      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                      color: 'white',
                      border: 'none',
                      borderRadius: '50px',
                      transition: 'transform 0.2s',
                      fontWeight: '600'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                    onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    <i className="bi bi-google me-2"></i> Sign in with Google
                  </button>
                </div>
              ) : (
                <div>
                  {/* Enhanced User Profile Card */}
                  <div className="card mb-4 shadow-sm" style={{
                    background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
                    border: 'none',
                    borderRadius: '20px'
                  }}>
                    <div className="card-body p-4">
                      <div className="d-flex align-items-center mb-4">
                        <div style={{ position: 'relative' }}>
                          <img 
                            src={userProfile?.photoURL} 
                            alt="Profile" 
                            className="rounded-circle shadow" 
                            width="90" 
                            height="90"
                            style={{ border: '4px solid white' }}
                          />
                          <div style={{
                            position: 'absolute',
                            bottom: '5px',
                            right: '5px',
                            width: '20px',
                            height: '20px',
                            background: '#10b981',
                            borderRadius: '50%',
                            border: '3px solid white'
                          }}></div>
                        </div>
                        <div className="ms-4 flex-grow-1">
                          <h3 className="mb-2 fw-bold">
                            <i className="bi bi-person-circle me-2" style={{ color: '#667eea' }}></i>
                            {userProfile?.displayName}
                          </h3>
                          <p className="text-muted mb-2">
                            <i className="bi bi-envelope-fill me-2"></i>
                            {userProfile?.email}
                          </p>
                          <p className="mb-0 fst-italic" style={{ color: '#666' }}>
                            <i className="bi bi-chat-quote-fill me-2"></i>
                            {userProfile?.bio}
                          </p>
                        </div>
                      </div>
                      
                      {/* Creative Statistics Grid */}
                      <div className="row g-3">
                        <div className="col-4">
                          <div className="text-center p-3 bg-white rounded-3 shadow-sm h-100" style={{
                            transition: 'transform 0.2s',
                            cursor: 'pointer'
                          }}
                          onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-5px)'}
                          onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                          >
                            <div className="mb-2" style={{
                              display: 'inline-block',
                              padding: '0.5rem',
                              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                              borderRadius: '10px'
                            }}>
                              <i className="bi bi-camera-video-fill text-white" style={{ fontSize: '1.5rem' }}></i>
                            </div>
                            <h4 className="mb-0 fw-bold text-primary">{userStats.meetingsHosted}</h4>
                            <small className="text-muted fw-semibold">Meetings Hosted</small>
                          </div>
                        </div>
                        <div className="col-4">
                          <div className="text-center p-3 bg-white rounded-3 shadow-sm h-100" style={{
                            transition: 'transform 0.2s',
                            cursor: 'pointer'
                          }}
                          onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-5px)'}
                          onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                          >
                            <div className="mb-2" style={{
                              display: 'inline-block',
                              padding: '0.5rem',
                              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                              borderRadius: '10px'
                            }}>
                              <i className="bi bi-people-fill text-white" style={{ fontSize: '1.5rem' }}></i>
                            </div>
                            <h4 className="mb-0 fw-bold text-success">{userStats.meetingsJoined}</h4>
                            <small className="text-muted fw-semibold">Meetings Joined</small>
                          </div>
                        </div>
                        <div className="col-4">
                          <div className="text-center p-3 bg-white rounded-3 shadow-sm h-100" style={{
                            transition: 'transform 0.2s',
                            cursor: 'pointer'
                          }}
                          onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-5px)'}
                          onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                          >
                            <div className="mb-2" style={{
                              display: 'inline-block',
                              padding: '0.5rem',
                              background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                              borderRadius: '10px'
                            }}>
                              <i className="bi bi-clock-history text-white" style={{ fontSize: '1.5rem' }}></i>
                            </div>
                            <h4 className="mb-0 fw-bold text-info">{userStats.totalMinutes}</h4>
                            <small className="text-muted fw-semibold">Total Minutes</small>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Creative Action Buttons */}
                  <div className="row g-4 mb-4">
                    <div className="col-md-6">
                      <div 
                        onClick={createMeeting} 
                        className="card border-0 shadow-sm h-100"
                        style={{
                          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                          cursor: 'pointer',
                          transition: 'all 0.3s',
                          borderRadius: '20px'
                        }}
                        onMouseOver={(e) => {
                          e.currentTarget.style.transform = 'translateY(-10px)';
                          e.currentTarget.style.boxShadow = '0 20px 40px rgba(102, 126, 234, 0.4)';
                        }}
                        onMouseOut={(e) => {
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow = '';
                        }}
                      >
                        <div className="card-body text-center py-5 text-white">
                          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>
                            <i className="bi bi-plus-circle-fill"></i>
                          </div>
                          <h4 className="fw-bold mb-2">Start New Meeting</h4>
                          <p className="mb-0 opacity-75">Create an instant meeting room</p>
                        </div>
                      </div>
                    </div>
                    <div className="col-md-6">
                      <div 
                        onClick={() => setCurrentView('join')} 
                        className="card border-0 shadow-sm h-100"
                        style={{
                          background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                          cursor: 'pointer',
                          transition: 'all 0.3s',
                          borderRadius: '20px'
                        }}
                        onMouseOver={(e) => {
                          e.currentTarget.style.transform = 'translateY(-10px)';
                          e.currentTarget.style.boxShadow = '0 20px 40px rgba(16, 185, 129, 0.4)';
                        }}
                        onMouseOut={(e) => {
                          e.currentTarget.style.transform = 'translateY(0)';
                          e.currentTarget.style.boxShadow = '';
                        }}
                      >
                        <div className="card-body text-center py-5 text-white">
                          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>
                            <i className="bi bi-door-open-fill"></i>
                          </div>
                          <h4 className="fw-bold mb-2">Join Meeting</h4>
                          <p className="mb-0 opacity-75">Enter a meeting code to join</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Sign Out Button */}
                  <div className="text-center">
                    <button 
                      onClick={handleSignOut} 
                      className="btn btn-outline-secondary btn-lg px-5"
                      style={{ borderRadius: '50px' }}
                    >
                      <i className="bi bi-box-arrow-right me-2"></i> Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Enhanced Copyright Footer */}
          <div className="text-center mt-4">
            <div className="card border-0 shadow-sm" style={{
              background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
              borderRadius: '15px'
            }}>
              <div className="card-body py-3">
                <p className="mb-1 fw-semibold" style={{ color: '#667eea' }}>
                  <i className="bi bi-c-circle me-1"></i>
                  {new Date().getFullYear()} VideoConnect Pro - All Rights Reserved
                </p>
                <p className="mb-0 text-muted">
                  <i className="bi bi-code-slash me-1"></i>
                  Crafted with <span style={{ color: '#ef4444' }}>❤️</span> by{' '}
                  <a 
                    href="https://Muindikelvin.github.io" 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="text-decoration-none fw-bold"
                    style={{ color: '#667eea' }}
                  >
                    Muindikelvin.github.io
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const ShareModal = () => (
    <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
      <div className="modal-dialog modal-dialog-centered">
        <div className="modal-content border-0 shadow-lg" style={{ borderRadius: '20px', overflow: 'hidden' }}>
          {/* Gradient Header */}
          <div style={{
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            padding: '2rem',
            position: 'relative'
          }}>
            <div style={{
              position: 'absolute',
              top: '-20px',
              right: '-20px',
              width: '100px',
              height: '100px',
              background: 'rgba(255,255,255,0.1)',
              borderRadius: '50%'
            }}></div>
            <button 
              type="button" 
              className="btn-close btn-close-white position-absolute top-0 end-0 m-3" 
              onClick={() => setShowShareModal(false)}
              style={{ zIndex: 10 }}
            ></button>
            <div className="text-center text-white position-relative">
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🎉</div>
              <h4 className="mb-0 fw-bold">Meeting Created Successfully!</h4>
            </div>
          </div>

          <div className="modal-body p-4">
            {/* Meeting Link Section */}
            <div className="mb-4">
              <div className="d-flex align-items-center mb-3">
                <div style={{
                  width: '40px',
                  height: '40px',
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: '1rem'
                }}>
                  <i className="bi bi-link-45deg text-white" style={{ fontSize: '1.5rem' }}></i>
                </div>
                <div>
                  <h6 className="mb-0 fw-bold">Your Meeting Link</h6>
                  <small className="text-muted">Share this with participants</small>
                </div>
              </div>
              
              <div className="input-group shadow-sm" style={{ borderRadius: '10px', overflow: 'hidden' }}>
                <input 
                  type="text" 
                  className="form-control border-0 bg-light" 
                  value={generatedMeetingLink} 
                  readOnly 
                  style={{ padding: '0.75rem 1rem' }}
                />
                <button 
                  className="btn border-0"
                  onClick={() => shareOnPlatform('copy')}
                  style={{
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    color: 'white',
                    padding: '0.75rem 1.5rem'
                  }}
                >
                  <i className="bi bi-clipboard-check me-1"></i> Copy
                </button>
              </div>
            </div>
            
            {/* Share Options */}
            <div>
              <div className="d-flex align-items-center mb-3">
                <div style={{
                  width: '40px',
                  height: '40px',
                  background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: '1rem'
                }}>
                  <i className="bi bi-share-fill text-white" style={{ fontSize: '1.2rem' }}></i>
                </div>
                <h6 className="mb-0 fw-bold">Quick Share</h6>
              </div>
              
              <div className="row g-3">
                <div className="col-4">
                  <button 
                    className="btn w-100 shadow-sm border-0 d-flex flex-column align-items-center py-3"
                    onClick={() => shareOnPlatform('whatsapp')}
                    style={{
                      background: '#25D366',
                      color: 'white',
                      borderRadius: '15px',
                      transition: 'transform 0.2s'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                    onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    <i className="bi bi-whatsapp" style={{ fontSize: '2rem', marginBottom: '0.5rem' }}></i>
                    <small className="fw-semibold">WhatsApp</small>
                  </button>
                </div>
                <div className="col-4">
                  <button 
                    className="btn w-100 shadow-sm border-0 d-flex flex-column align-items-center py-3"
                    onClick={() => shareOnPlatform('telegram')}
                    style={{
                      background: '#0088cc',
                      color: 'white',
                      borderRadius: '15px',
                      transition: 'transform 0.2s'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                    onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    <i className="bi bi-telegram" style={{ fontSize: '2rem', marginBottom: '0.5rem' }}></i>
                    <small className="fw-semibold">Telegram</small>
                  </button>
                </div>
                <div className="col-4">
                  <button 
                    className="btn w-100 shadow-sm border-0 d-flex flex-column align-items-center py-3"
                    onClick={() => shareOnPlatform('email')}
                    style={{
                      background: '#6c757d',
                      color: 'white',
                      borderRadius: '15px',
                      transition: 'transform 0.2s'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                    onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    <i className="bi bi-envelope-fill" style={{ fontSize: '2rem', marginBottom: '0.5rem' }}></i>
                    <small className="fw-semibold">Email</small>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="modal-footer border-0 p-4 pt-0">
            <button 
              type="button" 
              className="btn btn-lg w-100 shadow-sm border-0"
              onClick={() => {
                setShowShareModal(false);
                joinMeeting(meetingId);
              }}
              style={{
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                color: 'white',
                borderRadius: '50px',
                padding: '0.75rem 2rem',
                fontWeight: '600'
              }}
            >
              <i className="bi bi-camera-video-fill me-2"></i>
              Join Meeting Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const MediaPreview = () => (
    <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.9)' }}>
      <div className="modal-dialog modal-dialog-centered modal-lg">
        <div className="modal-content bg-dark text-white">
          <div className="modal-header border-secondary">
            <h5 className="modal-title">📹 Setup Your Camera & Microphone</h5>
          </div>
          <div className="modal-body text-center">
            <div className="position-relative mb-4" style={{ height: '400px' }}>
              {previewVideoEnabled ? (
                <video 
                  ref={previewVideoRef}
                  autoPlay 
                  muted 
                  playsInline
                  className="w-100 h-100 rounded"
                  style={{ objectFit: 'cover', backgroundColor: '#000' }}
                />
              ) : (
                <div className="w-100 h-100 d-flex align-items-center justify-content-center bg-black rounded">
                  <div>
                    <img src={userProfile?.photoURL} alt="Profile" className="rounded-circle mb-3" width="120" height="120" />
                    <h5>{userProfile?.displayName}</h5>
                    <p className="text-muted">Camera is off</p>
                  </div>
                </div>
              )}
            </div>
            
            <div className="d-flex justify-content-center gap-3 mb-3">
              <button 
                className={`btn ${previewVideoEnabled ? 'btn-light' : 'btn-danger'} btn-lg rounded-circle`}
                onClick={togglePreviewVideo}
                style={{ width: '60px', height: '60px' }}
              >
                {previewVideoEnabled ? '📷' : '📹'}
              </button>
              <button 
                className={`btn ${previewAudioEnabled ? 'btn-light' : 'btn-danger'} btn-lg rounded-circle`}
                onClick={togglePreviewAudio}
                style={{ width: '60px', height: '60px' }}
              >
                {previewAudioEnabled ? '🎤' : '🔇'}
              </button>
            </div>
            
            <p className="text-muted">
              {previewVideoEnabled ? '✅' : '❌'} Camera | {previewAudioEnabled ? '✅' : '❌'} Microphone
            </p>
          </div>
          <div className="modal-footer border-secondary">
            <button 
              type="button" 
              className="btn btn-secondary" 
              onClick={() => {
                setShowMediaPreview(false);
                if (previewStreamRef.current) {
                  previewStreamRef.current.getTracks().forEach(track => track.stop());
                }
                setCurrentView('home');
              }}
            >
              Cancel
            </button>
            <button 
              type="button" 
              className="btn btn-primary" 
              onClick={proceedToMeeting}
            >
              Join Now →
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderJoin = () => (
    <div className="container mt-5">
      <div className="row justify-content-center">
        <div className="col-md-6">
          <div className="card shadow">
            <div className="card-body p-4">
              <h3 className="card-title mb-4">🚪 Join Meeting</h3>
              <div className="mb-3">
                <label className="form-label">Meeting ID</label>
                <input 
                  type="text" 
                  className="form-control form-control-lg" 
                  value={meetingId}
                  onChange={(e) => setMeetingId(e.target.value)}
                  placeholder="Enter meeting ID"
                />
              </div>
              <button onClick={() => joinMeeting(meetingId)} className="btn btn-primary btn-lg w-100 mb-2">
                Join Meeting
              </button>
              <button onClick={() => setCurrentView('home')} className="btn btn-outline-secondary w-100">
                Back
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderWaiting = () => (
    <div className="container mt-5">
      <div className="row justify-content-center">
        <div className="col-md-6">
          <div className="card shadow text-center">
            <div className="card-body p-5">
              <div className="spinner-border text-primary mb-4" role="status" style={{ width: '3rem', height: '3rem' }}>
                <span className="visually-hidden">Loading...</span>
              </div>
              <h3>⏳ Waiting for host approval...</h3>
              <p className="text-muted">The host will admit you shortly</p>
              <div className="mt-4">
                <img src={userProfile?.photoURL} alt="Your profile" className="rounded-circle mb-2" width="60" height="60" />
                <p className="mb-0"><strong>{userProfile?.displayName}</strong></p>
                <small className="text-muted">{userProfile?.email}</small>
              </div>
              <button onClick={() => {
                if (admissionListenerRef.current) {
                  admissionListenerRef.current();
                  admissionListenerRef.current = null;
                }
                setCurrentView('home');
              }} className="btn btn-outline-secondary mt-4">
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const PollCreator = () => {
    const [question, setQuestion] = useState('');
    const [options, setOptions] = useState(['', '']);

    return (
      <div className="card border-0 bg-light mb-3">
        <div className="card-body">
          <h6 className="card-title">📊 Create Poll</h6>
          <input 
            type="text" 
            className="form-control mb-2" 
            placeholder="Poll question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          {options.map((opt, idx) => (
            <input 
              key={idx}
              type="text" 
              className="form-control mb-2" 
              placeholder={`Option ${idx + 1}`}
              value={opt}
              onChange={(e) => {
                const newOpts = [...options];
                newOpts[idx] = e.target.value;
                setOptions(newOpts);
              }}
            />
          ))}
          <button 
            onClick={() => setOptions([...options, ''])} 
            className="btn btn-sm btn-outline-primary me-2"
          >
            + Add Option
          </button>
          <button 
            onClick={() => {
              if (question && options.filter(o => o.trim()).length >= 2) {
                createPoll(question, options.filter(o => o.trim()));
                setQuestion('');
                setOptions(['', '']);
              }
            }} 
            className="btn btn-sm btn-success me-2"
          >
            Create Poll
          </button>
          <button 
            onClick={() => setShowPollCreator(false)} 
            className="btn btn-sm btn-secondary"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  };

  const renderMeeting = () => {
    const participantArray = Object.entries(participants);
    const gridColumns = participantArray.length === 1 ? 1 : participantArray.length === 2 ? 2 : participantArray.length <= 4 ? 2 : 3;

    return (
      <div className="container-fluid bg-dark text-white vh-100 p-0">
        <div className="row h-100 g-0">
          <div className="col p-0" style={{ width: `${100 - sidebarWidth}%` }}>
            <div className="position-relative h-100 bg-black">
              <div className="position-absolute top-0 start-0 m-3 d-flex gap-2" style={{ zIndex: 10 }}>
                <span className="badge bg-danger fs-6">🔴 LIVE</span>
                {isRecording && <span className="badge bg-warning fs-6">⏺️ Recording</span>}
                {isScreenSharing && <span className="badge bg-info fs-6">🖥️ Sharing</span>}
              </div>
              
              <div className="position-absolute top-0 end-0 m-3" style={{ zIndex: 10 }}>
                <span className="badge bg-secondary fs-6">
                  👥 {participantArray.length} participant{participantArray.length !== 1 ? 's' : ''}
                </span>
              </div>

              {Object.entries(participants).filter(([id, p]) => p.handRaised).length > 0 && (
                <div className="position-absolute top-0 start-50 translate-middle-x mt-5" style={{ zIndex: 10 }}>
                  <div className="bg-warning bg-opacity-90 text-dark rounded-pill px-3 py-2">
                    ✋ {Object.entries(participants).filter(([id, p]) => p.handRaised).length} hand(s) raised
                  </div>
                </div>
              )}

              <div className="h-100 p-3" style={{ display: 'grid', gridTemplateColumns: `repeat(${gridColumns}, 1fr)`, gap: '10px', gridAutoRows: 'minmax(0, 1fr)' }}>
                {participantArray.map(([id, participant]) => {
                  const isLocal = id === user.uid;
                  const remoteStream = remoteStreamsRef.current[id];
                  
                  return (
                    <div key={id} className="position-relative bg-secondary rounded overflow-hidden">
                      {isLocal ? (
                        participant.videoEnabled && !isVideoOff ? (
                          <video 
                            ref={localVideoRef}
                            autoPlay 
                            muted 
                            playsInline
                            className="w-100 h-100"
                            style={{ objectFit: 'cover' }}
                          />
                        ) : (
                          <div className="w-100 h-100 d-flex align-items-center justify-content-center bg-black">
                            <div className="text-center">
                              <img src={participant.userPhoto} alt={participant.userName} className="rounded-circle mb-2" width="80" height="80" />
                              <p className="text-white mb-0">{participant.userName} (You)</p>
                            </div>
                          </div>
                        )
                      ) : (
                        remoteStream && participant.videoEnabled ? (
                          <video 
                            ref={(el) => {
                              if (el && remoteStream) {
                                el.srcObject = remoteStream;
                              }
                            }}
                            autoPlay 
                            playsInline
                            className="w-100 h-100"
                            style={{ objectFit: 'cover' }}
                          />
                        ) : (
                          <div className="w-100 h-100 d-flex align-items-center justify-content-center bg-black">
                            <div className="text-center">
                              <img src={participant.userPhoto} alt={participant.userName} className="rounded-circle mb-2" width="80" height="80" />
                              <p className="text-white mb-0">{participant.userName}</p>
                            </div>
                          </div>
                        )
                      )}
                      
                      <div className="position-absolute bottom-0 start-0 m-2 bg-dark bg-opacity-75 rounded px-2 py-1">
                        <small className="d-flex align-items-center">
                          {participant.userName} {isLocal && '(You)'}
                          {participant.isHost && <span className="ms-1 badge bg-warning">👑</span>}
                          {participant.handRaised && <span className="ms-1">✋</span>}
                          {!participant.audioEnabled && <span className="ms-1">🔇</span>}
                          {!participant.videoEnabled && <span className="ms-1">📹</span>}
                        </small>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="position-absolute bottom-0 start-50 translate-middle-x mb-4" style={{ zIndex: 10 }}>
                <div className="btn-group bg-dark bg-opacity-75 rounded-pill p-2" role="group">
                  <button 
                    onClick={toggleMute} 
                    className={`btn ${isMuted ? 'btn-danger' : 'btn-light'} rounded-circle mx-1`}
                    title={isMuted ? 'Unmute' : 'Mute'}
                  >
                    {isMuted ? '🔇' : '🎤'}
                  </button>
                  
                  <button 
                    onClick={toggleVideo} 
                    className={`btn ${isVideoOff ? 'btn-danger' : 'btn-light'} rounded-circle mx-1`}
                    title={isVideoOff ? 'Start Video' : 'Stop Video'}
                  >
                    {isVideoOff ? '📹' : '📷'}
                  </button>
                  
                  <button 
                    onClick={toggleScreenShare} 
                    className={`btn ${isScreenSharing ? 'btn-warning' : 'btn-light'} rounded-circle mx-1`}
                    title="Share Screen"
                  >
                    🖥️
                  </button>
                  
                  {activeMeeting?.isHost && (
                    <button 
                      onClick={toggleRecording} 
                      className={`btn ${isRecording ? 'btn-danger' : 'btn-light'} rounded-circle mx-1`}
                      title={isRecording ? 'Stop Recording' : 'Start Recording'}
                    >
                      {isRecording ? '⏹️' : '⏺️'}
                    </button>
                  )}
                  
                  <button 
                    onClick={toggleRaiseHand} 
                    className={`btn ${isHandRaised ? 'btn-warning' : 'btn-light'} rounded-circle mx-1`}
                    title="Raise Hand"
                  >
                    {isHandRaised ? '✋' : '🙋'}
                  </button>
                  
                  <button 
                    onClick={requestToSpeak} 
                    className="btn btn-light rounded-circle mx-1"
                    title="Request to Speak"
                  >
                    🔔
                  </button>
                  
                  <button 
                    onClick={() => setShowNotes(!showNotes)} 
                    className="btn btn-light rounded-circle mx-1"
                    title="Meeting Notes"
                  >
                    📋
                  </button>
                  
                  <button 
                    onClick={() => setShowReactions(!showReactions)} 
                    className="btn btn-light rounded-circle mx-1"
                    title="Reactions"
                  >
                    😊
                  </button>
                  
                  <button 
                    onClick={leaveMeeting} 
                    className="btn btn-danger rounded-circle mx-1"
                    title="Leave Meeting"
                  >
                    📞
                  </button>
                </div>
                
                {showReactions && (
                  <div className="position-absolute bottom-100 start-50 translate-middle-x mb-2 bg-dark bg-opacity-90 rounded-pill p-2">
                    {['👍', '❤️', '😂', '🎉', '👏', '🔥', '👎', '🤔'].map(emoji => (
                      <button 
                        key={emoji}
                        onClick={() => {
                          sendReaction(emoji);
                          setShowReactions(false);
                        }} 
                        className="btn btn-link text-white fs-4 p-1"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div 
            onMouseDown={handleMouseDown}
            style={{
              width: '5px',
              cursor: 'col-resize',
              backgroundColor: '#495057',
              userSelect: 'none'
            }}
          />

          <div className="bg-dark border-start border-secondary p-3 d-flex flex-column" style={{ width: `${sidebarWidth}%`, height: '100vh', overflowY: 'auto' }}>
            {activeMeeting?.isHost && waitingRoom.length > 0 && (
              <div className="mb-3">
                <h6 className="text-warning">⏳ Waiting Room ({waitingRoom.length})</h6>
                <div className="list-group list-group-flush">
                  {waitingRoom.map(person => (
                    <div key={person.id} className="list-group-item bg-dark text-white border-secondary p-2 mb-2">
                      <div className="d-flex align-items-center mb-2">
                        <img src={person.userPhoto} alt="" className="rounded-circle me-2" width="35" height="35" />
                        <div className="flex-grow-1">
                          <small className="d-block">{person.userName}</small>
                          <small className="text-muted" style={{fontSize: '0.7rem'}}>{person.userEmail}</small>
                        </div>
                      </div>
                      <div className="btn-group btn-group-sm w-100">
                        <button onClick={() => admitParticipant(person.id, person)} className="btn btn-success btn-sm">
                          ✓ Admit
                        </button>
                        <button onClick={() => rejectParticipant(person.id)} className="btn btn-danger btn-sm">
                          ✗ Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeMeeting?.isHost && bellRequests.length > 0 && (
              <div className="mb-3">
                <h6 className="text-info">🔔 Speak Requests ({bellRequests.length})</h6>
                <div className="list-group list-group-flush">
                  {bellRequests.map(request => (
                    <div key={request.id} className="list-group-item bg-dark text-white border-secondary p-2 mb-2">
                      <div className="d-flex align-items-center mb-1">
                        <img src={request.userPhoto} alt="" className="rounded-circle me-2" width="30" height="30" />
                        <small>{request.userName}</small>
                      </div>
                      <button onClick={() => approveSpeakRequest(request.id)} className="btn btn-success btn-sm w-100">
                        ✓ Approve
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeMeeting?.isHost && (
              <div className="mb-3">
                <button 
                  onClick={() => setShowPollCreator(!showPollCreator)} 
                  className="btn btn-sm btn-outline-info w-100 mb-2"
                >
                  {showPollCreator ? '✕ Cancel Poll' : '📊 Create Poll'}
                </button>
                {showPollCreator && <PollCreator />}
              </div>
            )}

            {polls.length > 0 && (
              <div className="mb-3">
                <h6>📊 Polls</h6>
                {polls.filter(p => p.active).map(poll => (
                  <div key={poll.id} className="card bg-secondary text-white mb-2">
                    <div className="card-body p-2">
                      <small className="d-block mb-2"><strong>{poll.question}</strong></small>
                      {poll.options.map((opt, idx) => (
                        <div key={idx} className="mb-1">
                          <button 
                            onClick={() => votePoll(poll.id, idx)}
                            className="btn btn-sm btn-outline-light w-100 text-start"
                            disabled={poll.options.some(o => o.voters && o.voters.includes(user.uid))}
                          >
                            {opt.text} {opt.votes > 0 && `(${opt.votes})`}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {showNotes && (
              <div className="mb-3">
                <h6>📋 Meeting Notes</h6>
                <textarea 
                  className="form-control bg-dark text-white border-secondary mb-2" 
                  rows="4"
                  value={meetingNotes}
                  onChange={(e) => setMeetingNotes(e.target.value)}
                  placeholder="Take notes during the meeting..."
                />
                <button onClick={saveMeetingNotes} className="btn btn-sm btn-primary w-100">
                  💾 Save Notes
                </button>
              </div>
            )}

            <div className="flex-grow-1 d-flex flex-column">
              <h6>💬 Chat</h6>
              <div className="flex-grow-1 bg-black rounded p-2 mb-2" style={{ overflowY: 'auto', minHeight: '200px', maxHeight: '300px' }}>
                {chatMessages.map(msg => (
                  <div key={msg.id} className="mb-2">
                    <div className="d-flex align-items-center mb-1">
                      <img src={msg.userPhoto} alt="" className="rounded-circle me-2" width="25" height="25" />
                      <small className="text-info">{msg.userName}:</small>
                    </div>
                    <div className="text-white ms-4"><small>{msg.message}</small></div>
                  </div>
                ))}
              </div>
              <div className="input-group">
                <input 
                  type="text" 
                  className="form-control bg-dark text-white border-secondary" 
                  placeholder="Type message..."
                  value={messageInput}
                  onChange={(e) => setMessageInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                />
                <button onClick={sendMessage} className="btn btn-primary">Send</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {currentView === 'home' && renderHome()}
      {currentView === 'join' && renderJoin()}
      {currentView === 'waiting' && renderWaiting()}
      {currentView === 'meeting' && renderMeeting()}
      {showShareModal && <ShareModal />}
      {showMediaPreview && <MediaPreview />}
    </>
  );
};

export default VideoConference;