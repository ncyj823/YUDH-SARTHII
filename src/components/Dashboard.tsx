import React, { useState, useEffect } from 'react';
import Map from './Map';
import { Zone, Resource, Poll } from '../types';
import { MapPin, Shield, AlertTriangle, Info, CheckCircle, User, Users, ClipboardList, LogOut, AlertCircle, Plus } from 'lucide-react';
import { cn } from '../lib/utils';
import { validateAadhar, validatePAN } from '../lib/validation';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { onSnapshot, collection, addDoc, doc, getDoc, setDoc, updateDoc, arrayUnion, serverTimestamp, query, where, getCountFromServer, orderBy, limit } from 'firebase/firestore';

interface DashboardProps {
  userRole: 'citizen' | 'authority';
  onLogout: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ userRole, onLogout }) => {
  const [activeTab, setActiveTab] = useState<'map' | 'profile' | 'polls' | 'gov'>(userRole === 'citizen' ? 'map' : 'gov');
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null);
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [isVerifyingMember, setIsVerifyingMember] = useState(false);
  const [isAddingZone, setIsAddingZone] = useState(false);
  const [isAddingResource, setIsAddingResource] = useState(false);
  const [isCreatingPoll, setIsCreatingPoll] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Firestore States
  const [zones, setZones] = useState<Zone[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [familyMembers, setFamilyMembers] = useState<any[]>([]);
  const [stats, setStats] = useState({ totalRegistered: 0, verifiedCitizens: 0, criticalRequests: 0 });
  const [submittedPolls, setSubmittedPolls] = useState<Set<string>>(new Set());
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState<'zone' | 'resource' | null>(null);

  // Form states
  const [profileForm, setProfileForm] = useState({ fullName: '', idType: 'Aadhaar', idNumber: '' });
  const [newPoll, setNewPoll] = useState({ question: '', options: '' });
  const [newMember, setNewMember] = useState({ fullName: '', relation: '', idNumber: '' });
  const [memberError, setMemberError] = useState<string | null>(null);
  const [newZone, setNewZone] = useState({ name: '', status: 'safe' as any, description: '', location: '' });
  const [newResource, setNewResource] = useState({ name: '', type: 'shelter' as any, description: '', location: '' });

  // Recent Activity state
  const [recentActivity, setRecentActivity] = useState<any[]>([]);

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Poll responses state
  const [pollResponses, setPollResponses] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;

    // 1. Fetch User Profile
    const unsubProfile = onSnapshot(doc(db, 'users', uid), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setUserProfile(data);
        setFamilyMembers(data.familyMembers || []);
      } else {
        setUserProfile(null);
      }
      setIsLoading(false);
    });

    // 2. Fetch Zones
    const unsubZones = onSnapshot(collection(db, 'zones'), (snapshot) => {
      const zonesData = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Zone));
      setZones(zonesData);
    });

    // 3. Fetch Resources
    const unsubResources = onSnapshot(collection(db, 'resources'), (snapshot) => {
      const resourcesData = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Resource));
      setResources(resourcesData);
    });

    // 4. Fetch Polls
    const unsubPolls = onSnapshot(collection(db, 'polls'), (snapshot) => {
      const pollsData = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Poll));
      setPolls(pollsData);
    });

    // 5. Fetch User's Poll Responses
    const unsubResponses = onSnapshot(query(collection(db, 'pollResponses'), where('userId', '==', uid)), (snapshot) => {
      const respondedIds = new Set(snapshot.docs.map(d => d.data().pollId));
      setSubmittedPolls(respondedIds);
    });

    // 6. Fetch Stats
    const fetchStats = async () => {
      const usersCol = collection(db, 'users');
      const totalSnap = await getCountFromServer(usersCol);
      const verifiedSnap = await getCountFromServer(query(usersCol, where('isVerified', '==', true)));
      const criticalSnap = await getCountFromServer(collection(db, 'pollResponses')); // Mocking critical as poll responses count or zones

      setStats({
        totalRegistered: totalSnap.data().count,
        verifiedCitizens: verifiedSnap.data().count,
        criticalRequests: criticalSnap.data().count
      });
    };
    fetchStats();

    // 7. Fetch Activity Log
    // NOTE: Requires Firestore composite index on activityLog: createdAt DESC
    // Create it at: Firebase Console → Firestore → Indexes → Add Index
    const unsubActivity = onSnapshot(query(collection(db, 'activityLog'), orderBy('createdAt', 'desc'), limit(20)), (snapshot) => {
      const activityData = snapshot.docs.map(d => {
        const data = d.data();
        const date = data.createdAt?.toDate() || new Date();
        return {
          time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          action: data.action,
          actor: data.actor,
          status: data.status
        };
      });
      setRecentActivity(activityData);
    });

    return () => {
      unsubProfile();
      unsubZones();
      unsubResources();
      unsubPolls();
      unsubResponses();
      unsubActivity();
    };
  }, []);

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;

    const cleanId = profileForm.idNumber.replace(/[-\s]/g, '').toUpperCase();
    const isAadhar = cleanId.length === 12;
    const isPAN = cleanId.length === 10;

    let isValid = false;
    let idType = 'ID';

    if (isAadhar) {
      isValid = validateAadhar(cleanId);
      idType = 'AADHAR';
    } else if (isPAN) {
      isValid = validatePAN(cleanId);
      idType = 'PAN';
    }

    if (!isValid) {
      alert(`Invalid ${isAadhar ? 'Aadhar' : isPAN ? 'PAN' : 'ID'} number. Please check the format and digits.`);
      return;
    }

    try {
      await setDoc(doc(db, 'users', uid), {
        fullName: profileForm.fullName,
        idType: idType.toLowerCase(),
        idNumber: cleanId,
        isVerified: false,
        familyMembers: [],
        role: userRole,
        createdAt: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${uid}`);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setMemberError(null);
    if (!newMember.fullName || !newMember.relation || !newMember.idNumber || !auth.currentUser) return;

    const cleanId = newMember.idNumber.replace(/[-\s]/g, '').toUpperCase();
    const isAadhar = cleanId.length === 12;
    const isPAN = cleanId.length === 10;

    let isValid = false;
    let idType = 'ID';

    if (isAadhar) {
      isValid = validateAadhar(cleanId);
      idType = 'AADHAR';
    } else if (isPAN) {
      isValid = validatePAN(cleanId);
      idType = 'PAN';
    }

    if (!isValid) {
      setMemberError(`Invalid ${isAadhar ? 'Aadhar' : isPAN ? 'PAN' : 'ID'} number. Please check the format and digits.`);
      return;
    }

    setIsVerifyingMember(true);
    try {
      const member = {
        id: Math.random().toString(36).substr(2, 9),
        fullName: newMember.fullName,
        relation: newMember.relation,
        idType: idType.toLowerCase(),
        idNumber: cleanId,
        isVerified: false
      };

      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        familyMembers: arrayUnion(member)
      });

      showToast('Family member added!', 'success');
      setIsVerifyingMember(false);
      setIsAddingMember(false);
      setNewMember({ fullName: '', relation: '', idNumber: '' });
    } catch (error) {
      console.error("Failed to add member:", error);
      setIsVerifyingMember(false);
    }
  };

  const handlePollSubmit = async (pollId: string) => {
    if (!pollResponses[pollId] || !auth.currentUser) return;
    
    try {
      const optionIndex = polls.find(p => p.id === pollId)?.options.indexOf(pollResponses[pollId]) ?? 0;
      await addDoc(collection(db, 'pollResponses'), {
        pollId,
        userId: auth.currentUser.uid,
        optionIndex,
        timestamp: serverTimestamp()
      });
      setSubmittedPolls(prev => new Set(prev).add(pollId));
    } catch (error) {
      console.error("Poll submission failed:", error);
    }
  };

  const fetchSuggestions = async (query: string, type: 'zone' | 'resource') => {
    if (!query || query.length < 3) {
      setSuggestions([]);
      setShowSuggestions(null);
      return;
    }

    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!token) return;

    try {
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${token}&autocomplete=true&limit=5`
      );
      const data = await response.json();
      setSuggestions(data.features || []);
      setShowSuggestions(type);
    } catch (error) {
      console.error("Geocoding suggestions failed:", error);
    }
  };

  const handleSuggestionClick = (suggestion: any, type: 'zone' | 'resource') => {
    const [lng, lat] = suggestion.center;
    if (type === 'zone') {
      setNewZone({ ...newZone, location: suggestion.place_name });
    } else {
      setNewResource({ ...newResource, location: suggestion.place_name });
    }
    setSuggestions([]);
    setShowSuggestions(null);
  };

  const handleCreatePoll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPoll.question || !newPoll.options) return;

    try {
      await addDoc(collection(db, 'polls'), {
        question: newPoll.question,
        options: newPoll.options.split(',').map(o => o.trim()),
        createdAt: serverTimestamp(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        active: true
      });

      await addDoc(collection(db, 'activityLog'), {
        action: `Poll Created: ${newPoll.question.slice(0, 40)}...`,
        actor: auth.currentUser?.email || 'Authority',
        status: 'Success',
        createdAt: serverTimestamp()
      });

      showToast('Poll created successfully!', 'success');
      setNewPoll({ question: '', options: '' });
      setIsCreatingPoll(false);
    } catch (error) {
      console.error("Failed to create poll:", error);
      showToast('Failed to create poll. Try again.', 'error');
    }
  };

  const handleManualZoneAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newZone.location) return;

    try {
      const token = import.meta.env.VITE_MAPBOX_TOKEN;
      let lat = 28.6139;
      let lng = 77.2090;

      if (token) {
        const response = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(newZone.location)}.json?access_token=${token}&limit=1`
        );
        const data = await response.json();
        if (data.features && data.features.length > 0) {
          [lng, lat] = data.features[0].center;
        }
      }
      
      const offset = 0.005;
      const zoneData = {
        name: newZone.name || `Zone in ${newZone.location}`,
        status: newZone.status,
        description: newZone.description,
        location: newZone.location,
        coordinates: [
          { lat: lat + offset, lng: lng - offset },
          { lat: lat + offset, lng: lng + offset },
          { lat: lat - offset, lng: lng + offset },
          { lat: lat - offset, lng: lng - offset },
          { lat: lat + offset, lng: lng - offset }
        ],
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, 'zones'), zoneData);

      await addDoc(collection(db, 'activityLog'), {
        action: `Zone Marked: ${zoneData.name} (${zoneData.status})`,
        actor: auth.currentUser?.email || 'Authority',
        status: 'Success',
        createdAt: serverTimestamp()
      });

      showToast('Zone marked successfully!', 'success');
      setNewZone({ name: '', status: 'safe', description: '', location: '' });
    } catch (error) {
      console.error("Geocoding or Firestore failed:", error);
      showToast('Failed to mark zone. Try again.', 'error');
    }
  };

  const handleManualResourceAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newResource.location) return;

    try {
      const token = import.meta.env.VITE_MAPBOX_TOKEN;
      let lat = 28.6139;
      let lng = 77.2090;

      if (token) {
        const response = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(newResource.location)}.json?access_token=${token}&limit=1`
        );
        const data = await response.json();
        if (data.features && data.features.length > 0) {
          [lng, lat] = data.features[0].center;
        }
      }
      
      const resData = {
        name: newResource.name || `Resource in ${newResource.location}`,
        type: newResource.type,
        lat,
        lng,
        description: newResource.description,
        location: newResource.location,
        createdAt: serverTimestamp()
      };

      await addDoc(collection(db, 'resources'), resData);

      await addDoc(collection(db, 'activityLog'), {
        action: `Resource Added: ${resData.name} (${resData.type})`,
        actor: auth.currentUser?.email || 'Authority',
        status: 'Success',
        createdAt: serverTimestamp()
      });

      showToast('Resource added successfully!', 'success');
      setNewResource({ name: '', type: 'shelter', description: '', location: '' });
    } catch (error) {
      console.error("Geocoding or Firestore failed:", error);
      showToast('Failed to add resource. Try again.', 'error');
    }
  };

  const handleMapClick = async (lat: number, lng: number) => {
    if (isAddingResource && userRole === 'authority') {
      try {
        const newResourceData = {
          name: newResource.name || 'New Resource',
          type: newResource.type,
          lat,
          lng,
          description: newResource.description,
          location: 'Map Point',
          createdAt: serverTimestamp()
        };
        await addDoc(collection(db, 'resources'), newResourceData);

        await addDoc(collection(db, 'activityLog'), {
          action: `Resource Placed on Map: ${newResourceData.name}`,
          actor: auth.currentUser?.email || 'Authority',
          status: 'Success',
          createdAt: serverTimestamp()
        });

        showToast('Resource added successfully!', 'success');
        setIsAddingResource(false);
        setNewResource({ name: '', type: 'shelter', description: '', location: '' });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'resources');
        showToast('Failed to add resource. Try again.', 'error');
      }
    } else if (isAddingZone && userRole === 'authority') {
      try {
        // For simplicity, create a small square around the click
        const offset = 0.005;
        const newZoneData = {
          name: newZone.name || 'New Zone',
          status: newZone.status,
          description: newZone.description,
          location: 'Map Point',
          coordinates: [
            { lat: lat + offset, lng: lng - offset },
            { lat: lat + offset, lng: lng + offset },
            { lat: lat - offset, lng: lng + offset },
            { lat: lat - offset, lng: lng - offset },
            { lat: lat + offset, lng: lng - offset }
          ],
          createdAt: serverTimestamp()
        };
        await addDoc(collection(db, 'zones'), newZoneData);

        await addDoc(collection(db, 'activityLog'), {
          action: `Zone Placed on Map: ${newZoneData.name}`,
          actor: auth.currentUser?.email || 'Authority',
          status: 'Success',
          createdAt: serverTimestamp()
        });

        showToast('Zone marked successfully!', 'success');
        setIsAddingZone(false);
        setNewZone({ name: '', status: 'safe', description: '', location: '' });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'zones');
        showToast('Failed to mark zone. Try again.', 'error');
      }
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a] text-white font-sans overflow-hidden">
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-6 py-3 rounded-xl font-bold text-sm shadow-2xl
          animate-in slide-in-from-top-4 duration-300 flex items-center gap-2
          ${toast.type === 'success' 
            ? 'bg-emerald-600 text-white' 
            : 'bg-red-600 text-white'}`}>
          {toast.type === 'success' ? '✓' : '✗'} {toast.message}
        </div>
      )}
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-[#141414] border-b border-white/10 shadow-lg z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-red-600 rounded-lg shadow-inner">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight uppercase">RAPID CRISIS RESPONSE</h1>
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-semibold">Government of India • Emergency Services</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden md:flex flex-col items-end">
            <span className="text-xs font-medium">{userRole === 'citizen' ? 'Verified Citizen' : 'Authority Officer'}</span>
            <span className={cn(
              "text-[10px] font-bold uppercase",
              userRole === 'citizen' ? "text-emerald-500" : "text-red-500"
            )}>Status: {userRole === 'citizen' ? 'Secure' : 'Active Duty'}</span>
          </div>
          <button 
            onClick={onLogout}
            className="p-2 hover:bg-white/5 rounded-full transition-colors"
          >
            <LogOut className="w-5 h-5 text-zinc-400" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 relative flex flex-col md:flex-row overflow-hidden">
        {/* Sidebar Navigation */}
        <nav className="flex md:flex-col w-full md:w-20 bg-[#141414] border-r border-white/10 p-2 md:p-4 gap-4 justify-around md:justify-start z-20">
          {userRole === 'citizen' && (
            <>
              <NavButton 
                active={activeTab === 'map'} 
                onClick={() => setActiveTab('map')} 
                icon={<MapPin className="w-6 h-6" />} 
                label="Map" 
              />
              <NavButton 
                active={activeTab === 'profile'} 
                onClick={() => setActiveTab('profile')} 
                icon={<User className="w-6 h-6" />} 
                label="Profile" 
              />
            </>
          )}
          <NavButton 
            active={activeTab === 'polls'} 
            onClick={() => setActiveTab('polls')} 
            icon={<ClipboardList className="w-6 h-6" />} 
            label="Polls" 
          />
          {userRole === 'authority' && (
            <NavButton 
              active={activeTab === 'gov'} 
              onClick={() => setActiveTab('gov')} 
              icon={<Shield className="w-6 h-6" />} 
              label="Gov" 
            />
          )}
        </nav>

        {/* Content Area */}
          <div className="flex-1 relative overflow-y-auto">
            {/* Profile Completion Modal */}
            {!userProfile && !isLoading && userRole === 'citizen' && (
              <div className="fixed inset-0 bg-black/90 backdrop-blur-md flex items-center justify-center z-[100] p-4">
                <div className="bg-[#141414] border border-white/10 p-8 rounded-3xl w-full max-w-md shadow-2xl space-y-6">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 bg-red-600 rounded-lg">
                      <User className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="text-xl font-bold uppercase tracking-tight">Complete Your Profile</h3>
                  </div>
                  <p className="text-zinc-400 text-sm">Please provide your details to access government emergency services and verification.</p>
                  <form onSubmit={handleProfileSubmit} className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase text-zinc-500">Full Name</label>
                      <input 
                        type="text" 
                        required 
                        value={profileForm.fullName}
                        onChange={e => setProfileForm({...profileForm, fullName: e.target.value})}
                        className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm focus:border-red-500 outline-none"
                        placeholder="As per Aadhar/PAN"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold uppercase text-zinc-500">Aadhar / PAN Number</label>
                      <input 
                        type="text" 
                        required 
                        value={profileForm.idNumber}
                        onChange={e => setProfileForm({...profileForm, idNumber: e.target.value})}
                        className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm focus:border-red-500 outline-none font-mono"
                        placeholder="XXXX-XXXX-XXXX"
                      />
                    </div>
                    <button 
                      type="submit" 
                      className="w-full py-4 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl uppercase tracking-widest transition-all shadow-lg shadow-red-600/20"
                    >
                      Verify & Save Profile
                    </button>
                  </form>
                </div>
              </div>
            )}

            {activeTab === 'map' && userRole === 'citizen' && (
            <div className="w-full h-full relative">
              <Map 
                zones={zones} 
                resources={resources} 
                onZoneClick={setSelectedZone}
                onResourceClick={setSelectedResource}
                onMapClick={handleMapClick}
              />

              {/* Overlay Info Panels */}
              {selectedZone && (
                <div className="absolute top-4 right-4 w-80 bg-black/90 p-4 rounded-xl border border-white/20 backdrop-blur-md shadow-2xl animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-lg">{selectedZone.name}</h3>
                    <button onClick={() => setSelectedZone(null)} className="text-zinc-500 hover:text-white">×</button>
                  </div>
                  <div className={cn(
                    "inline-flex items-center gap-2 px-2 py-1 rounded text-[10px] font-bold uppercase mb-3",
                    selectedZone.status === 'safe' ? "bg-emerald-500/20 text-emerald-500" : 
                    selectedZone.status === 'warring' ? "bg-amber-500/20 text-amber-500" : "bg-red-500/20 text-red-500"
                  )}>
                    {selectedZone.status === 'safe' ? <CheckCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                    {selectedZone.status}
                  </div>
                  <p className="text-sm text-zinc-300 leading-relaxed">{selectedZone.description}</p>
                </div>
              )}

              {selectedResource && (
                <div className="absolute top-4 right-4 w-80 bg-black/90 p-4 rounded-xl border border-white/20 backdrop-blur-md shadow-2xl animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-bold text-lg">{selectedResource.name}</h3>
                    <button onClick={() => setSelectedResource(null)} className="text-zinc-500 hover:text-white">×</button>
                  </div>
                  <div className="text-[10px] font-bold uppercase text-blue-400 mb-3">{selectedResource.type}</div>
                  <p className="text-sm text-zinc-300 mb-4 leading-relaxed">{selectedResource.description}</p>
                  {selectedResource.contact && (
                    <div className="flex items-center gap-2 p-2 bg-white/5 rounded border border-white/10">
                      <Info className="w-4 h-4 text-blue-400" />
                      <span className="text-xs font-mono">{selectedResource.contact}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'profile' && (
            <div className="p-8 max-w-4xl mx-auto space-y-8">
              {/* Profile Header */}
              <div className="flex items-center gap-6 p-6 bg-[#141414] rounded-2xl border border-white/10 shadow-xl">
                <div className="w-24 h-24 bg-zinc-800 rounded-full flex items-center justify-center border-4 border-emerald-500/30">
                  <User className="w-12 h-12 text-zinc-500" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-bold">{userProfile?.fullName || auth.currentUser?.email || 'User'}</h2>
                    {userProfile?.isVerified && (
                      <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-500 text-[10px] font-bold uppercase rounded border border-emerald-500/30">Verified</span>
                    )}
                  </div>
                  <p className="text-zinc-500 text-sm font-mono mt-1">ID: {userProfile?.idNumber || 'Not Provided'}</p>
                </div>
              </div>

              {/* Family Members Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <Users className="w-5 h-5 text-red-500" />
                    Family Members
                  </h3>
                  <button 
                    onClick={() => {
                      setIsAddingMember(true);
                      setMemberError(null);
                    }}
                    className="text-xs font-bold text-red-500 hover:text-red-400 transition-colors uppercase tracking-wider"
                  >
                    + Add Member
                  </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {familyMembers.map((member, idx) => (
                    <FamilyCard key={idx} name={member.fullName} relation={member.relation} id={member.idNumber} verified={member.isVerified} />
                  ))}
                </div>
              </div>

              {/* Add Member Modal */}
              {isAddingMember && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                  <div className="bg-[#141414] border border-white/10 p-8 rounded-3xl w-full max-w-md shadow-2xl space-y-6">
                    <h3 className="text-xl font-bold uppercase tracking-tight">Add Family Member</h3>
                    <form onSubmit={handleAddMember} className="space-y-4">
                      {memberError && (
                        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-center gap-2 text-red-500 text-[10px] animate-in slide-in-from-top-2">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span>{memberError}</span>
                        </div>
                      )}
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold uppercase text-zinc-500">Full Name</label>
                        <input 
                          type="text" 
                          required 
                          value={newMember.fullName}
                          onChange={e => setNewMember({...newMember, fullName: e.target.value})}
                          className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm focus:border-red-500 outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold uppercase text-zinc-500">Relation</label>
                        <select 
                          required 
                          value={newMember.relation}
                          onChange={e => setNewMember({...newMember, relation: e.target.value})}
                          className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm focus:border-red-500 outline-none"
                        >
                          <option value="">Select Relation</option>
                          <option value="Spouse">Spouse</option>
                          <option value="Son">Son</option>
                          <option value="Daughter">Daughter</option>
                          <option value="Parent">Parent</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold uppercase text-zinc-500">Aadhar / PAN Number</label>
                        <input 
                          type="text" 
                          required 
                          value={newMember.idNumber}
                          onChange={e => setNewMember({...newMember, idNumber: e.target.value})}
                          className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm focus:border-red-500 outline-none font-mono"
                          placeholder="XXXX-XXXX-XXXX or ABCDE1234F"
                        />
                      </div>
                      <div className="flex gap-3 pt-2">
                        <button 
                          type="button" 
                          onClick={() => setIsAddingMember(false)}
                          className="flex-1 py-3 text-xs font-bold uppercase tracking-wider bg-white/5 hover:bg-white/10 rounded-xl transition-colors"
                        >
                          Cancel
                        </button>
                        <button 
                          type="submit" 
                          disabled={isVerifyingMember}
                          className="flex-1 py-3 text-xs font-bold uppercase tracking-wider bg-red-600 hover:bg-red-700 disabled:bg-zinc-800 rounded-xl transition-colors flex items-center justify-center gap-2"
                        >
                          {isVerifyingMember ? (
                            <>
                              <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              <span>Verifying...</span>
                            </>
                          ) : (
                            'Add Member'
                          )}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'polls' && (
            <div className="p-8 max-w-2xl mx-auto space-y-6">
              {userRole === 'citizen' ? (
                <>
                  <h2 className="text-2xl font-bold flex items-center gap-3">
                    <ClipboardList className="w-6 h-6 text-red-500" />
                    Active Polls & Forms
                  </h2>
                  <p className="text-zinc-500 text-sm">Your feedback helps the government allocate resources effectively. Please respond to the following enquiries.</p>
                  
                  {polls.map(poll => (
                    <div key={poll.id} className="p-6 bg-[#141414] rounded-2xl border border-white/10 shadow-xl space-y-4">
                      <h4 className="font-bold text-lg leading-tight">{poll.question}</h4>
                      {submittedPolls.has(poll.id) ? (
                        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center gap-3">
                          <CheckCircle className="w-5 h-5 text-emerald-500" />
                          <span className="text-sm font-bold text-emerald-500 uppercase tracking-wider">Response Submitted Successfully</span>
                        </div>
                      ) : (
                        <>
                          <div className="space-y-2">
                            {poll.options.map((option, idx) => (
                              <button 
                                key={idx} 
                                onClick={() => setPollResponses({ ...pollResponses, [poll.id]: option })}
                                className={cn(
                                  "w-full p-4 text-left border rounded-xl transition-all group flex items-center justify-between",
                                  pollResponses[poll.id] === option 
                                    ? "bg-red-600/10 border-red-500/50" 
                                    : "bg-white/5 hover:bg-white/10 border-white/10"
                                )}
                              >
                                <span className="text-sm font-medium">{option}</span>
                                <div className={cn(
                                  "w-5 h-5 rounded-full border-2 transition-colors",
                                  pollResponses[poll.id] === option ? "border-red-500 bg-red-500" : "border-zinc-700 group-hover:border-red-500"
                                )} />
                              </button>
                            ))}
                          </div>
                          <div className="flex items-center justify-between pt-4 border-t border-white/5">
                            <span className="text-[10px] text-zinc-500 uppercase font-bold">Expires in 14 hours</span>
                            <button 
                              onClick={() => handlePollSubmit(poll.id)}
                              disabled={!pollResponses[poll.id]}
                              className="px-6 py-2 bg-red-600 hover:bg-red-700 disabled:bg-zinc-800 text-white text-xs font-bold rounded-lg transition-colors shadow-lg shadow-red-600/20"
                            >
                              Submit Response
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </>
              ) : (
                <>
                  <h2 className="text-2xl font-bold flex items-center gap-3">
                    <ClipboardList className="w-6 h-6 text-red-500" />
                    Poll Management
                  </h2>
                  <p className="text-zinc-500 text-sm">Create and manage polls to gather critical information from citizens.</p>
                  
                  <div className="p-6 bg-[#141414] rounded-2xl border border-white/10 shadow-xl space-y-6">
                    <h3 className="text-lg font-bold">Create New Poll</h3>
                    <form onSubmit={handleCreatePoll} className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold uppercase text-zinc-500">Question</label>
                        <input 
                          type="text" 
                          required 
                          placeholder="e.g. Do you have access to clean drinking water?"
                          value={newPoll.question}
                          onChange={e => setNewPoll({...newPoll, question: e.target.value})}
                          className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm focus:border-red-500 outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold uppercase text-zinc-500">Options (Comma separated)</label>
                        <input 
                          type="text" 
                          required 
                          placeholder="e.g. Yes, No, Limited Access"
                          value={newPoll.options}
                          onChange={e => setNewPoll({...newPoll, options: e.target.value})}
                          className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm focus:border-red-500 outline-none"
                        />
                      </div>
                      <button 
                        type="submit" 
                        className="w-full py-4 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl uppercase tracking-widest transition-all shadow-lg shadow-red-600/20"
                      >
                        Issue Poll to Citizens
                      </button>
                    </form>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-lg font-bold">Active Polls</h3>
                    {polls.length === 0 ? (
                      <p className="text-zinc-500 text-sm italic">No active polls found.</p>
                    ) : (
                      <div className="grid gap-4">
                        {polls.map(poll => (
                          <div key={poll.id} className="p-4 bg-white/5 rounded-xl border border-white/10 flex items-center justify-between">
                            <div>
                              <h4 className="font-bold text-sm">{poll.question}</h4>
                              <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">{poll.options.join(' • ')}</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-500 text-[10px] font-bold uppercase rounded border border-emerald-500/20">Active</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'gov' && (
            <div className="p-8 max-w-4xl mx-auto space-y-8">
              <div className="p-6 bg-red-600/10 border border-red-600/30 rounded-2xl">
                <h2 className="text-xl font-bold text-red-500 flex items-center gap-2 mb-2">
                  <Shield className="w-6 h-6" />
                  Government Authority Portal
                </h2>
                <p className="text-zinc-400 text-sm">Restricted access. This portal is for authorized personnel only. All actions are logged and tracked.</p>
              </div>

              {/* Manual Marking Forms */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-[#141414] p-6 rounded-2xl border border-white/10 space-y-4">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                    Mark Safe/Danger Zone
                  </h3>
                  <form onSubmit={handleManualZoneAdd} className="space-y-3">
                    <input 
                      type="text" 
                      placeholder="Zone Name (e.g. Red Fort Area)"
                      value={newZone.name}
                      onChange={e => setNewZone({...newZone, name: e.target.value})}
                      className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm focus:border-red-500 outline-none"
                    />
                    <div className="relative">
                      <input 
                        type="text" 
                        placeholder="Location (City, District, State)"
                        value={newZone.location}
                        onChange={e => {
                          setNewZone({...newZone, location: e.target.value});
                          fetchSuggestions(e.target.value, 'zone');
                        }}
                        className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm focus:border-red-500 outline-none"
                      />
                      {showSuggestions === 'zone' && suggestions.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl z-[60] overflow-hidden">
                          {suggestions.map((s, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => handleSuggestionClick(s, 'zone')}
                              className="w-full p-3 text-left text-xs hover:bg-white/5 border-b border-white/5 last:border-0 transition-colors"
                            >
                              {s.place_name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <select 
                      value={newZone.status}
                      onChange={e => setNewZone({...newZone, status: e.target.value as any})}
                      className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm focus:border-red-500 outline-none"
                    >
                      <option value="safe">Safe Zone</option>
                      <option value="warring">Warring Zone</option>
                      <option value="danger">Dangerous Zone</option>
                    </select>
                    <textarea 
                      placeholder="Description"
                      value={newZone.description}
                      onChange={e => setNewZone({...newZone, description: e.target.value})}
                      className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm focus:border-red-500 outline-none h-20"
                    />
                    <button type="submit" className="w-full py-3 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl uppercase tracking-widest transition-colors">
                      Mark Zone
                    </button>
                  </form>
                </div>

                <div className="bg-[#141414] p-6 rounded-2xl border border-white/10 space-y-4">
                  <h3 className="text-lg font-bold flex items-center gap-2">
                    <MapPin className="w-5 h-5 text-blue-500" />
                    Add Supply Center
                  </h3>
                  <form onSubmit={handleManualResourceAdd} className="space-y-3">
                    <input 
                      type="text" 
                      placeholder="Center Name"
                      value={newResource.name}
                      onChange={e => setNewResource({...newResource, name: e.target.value})}
                      className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm focus:border-red-500 outline-none"
                    />
                    <div className="relative">
                      <input 
                        type="text" 
                        placeholder="Location (City, District, State)"
                        value={newResource.location}
                        onChange={e => {
                          setNewResource({...newResource, location: e.target.value});
                          fetchSuggestions(e.target.value, 'resource');
                        }}
                        className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm focus:border-red-500 outline-none"
                      />
                      {showSuggestions === 'resource' && suggestions.length > 0 && (
                        <div className="absolute top-full left-0 right-0 mt-1 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl z-[60] overflow-hidden">
                          {suggestions.map((s, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => handleSuggestionClick(s, 'resource')}
                              className="w-full p-3 text-left text-xs hover:bg-white/5 border-b border-white/5 last:border-0 transition-colors"
                            >
                              {s.place_name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <select 
                      value={newResource.type}
                      onChange={e => setNewResource({...newResource, type: e.target.value as any})}
                      className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm focus:border-red-500 outline-none"
                    >
                      <option value="shelter">Shelter</option>
                      <option value="medical">Medical Center</option>
                      <option value="food">Food Supply</option>
                    </select>
                    <textarea 
                      placeholder="Capacity/Details"
                      value={newResource.description}
                      onChange={e => setNewResource({...newResource, description: e.target.value})}
                      className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm focus:border-red-500 outline-none h-20"
                    />
                    <button type="submit" className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl uppercase tracking-widest transition-colors">
                      Add Center
                    </button>
                  </form>
                </div>
              </div>

              {/* Live Map Preview */}
              <div className="space-y-4">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-emerald-500" />
                  Live Map Preview
                </h3>
                <div className="w-full h-[400px] rounded-2xl border border-white/10 overflow-hidden shadow-2xl">
                  <Map 
                    zones={zones} 
                    resources={resources} 
                    onZoneClick={setSelectedZone}
                    onResourceClick={setSelectedResource}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <GovStatCard label="Total Registered" value={stats.totalRegistered.toLocaleString()} color="text-white" />
                <GovStatCard label="Verified Citizens" value={stats.verifiedCitizens.toLocaleString()} color="text-emerald-500" />
                <GovStatCard label="Critical Requests" value={stats.criticalRequests.toLocaleString()} color="text-red-500" />
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-bold">Recent Activity</h3>
                <div className="bg-[#141414] rounded-2xl border border-white/10 overflow-hidden">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-white/5 text-[10px] uppercase font-bold tracking-wider text-zinc-500">
                      <tr>
                        <th className="px-6 py-4">Timestamp</th>
                        <th className="px-6 py-4">Action</th>
                        <th className="px-6 py-4">Actor</th>
                        <th className="px-6 py-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {recentActivity.map((activity, idx) => (
                        <ActivityRow 
                          key={idx}
                          time={activity.time} 
                          action={activity.action} 
                          actor={activity.actor} 
                          status={activity.status} 
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer / Status Bar */}
      <footer className="px-6 py-2 bg-[#0a0a0a] border-t border-white/10 flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span>Network: 2G (Low Bandwidth Mode)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-emerald-500 rounded-full" />
            <span>Database: Synced</span>
          </div>
        </div>
        <div>
          <span>Last Updated: 24 Mar 2026 10:00 UTC</span>
        </div>
      </footer>
    </div>
  );
};

const NavButton: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({ active, onClick, icon, label }) => (
  <button 
    onClick={onClick}
    className={cn(
      "flex flex-col items-center gap-1 p-2 rounded-xl transition-all duration-300 group",
      active ? "bg-red-600 text-white shadow-lg shadow-red-600/20" : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
    )}
  >
    {icon}
    <span className="text-[9px] font-bold uppercase tracking-wider">{label}</span>
  </button>
);

const FamilyCard: React.FC<{ name: string; relation: string; id: string; verified: boolean }> = ({ name, relation, id, verified }) => (
  <div className="p-4 bg-white/5 rounded-xl border border-white/10 flex items-center justify-between">
    <div>
      <h4 className="font-bold text-sm">{name}</h4>
      <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">{relation}</p>
      <p className="text-[10px] font-mono text-zinc-600 mt-1">{id}</p>
    </div>
    {verified ? (
      <div className="flex items-center gap-1 text-emerald-500">
        <CheckCircle className="w-4 h-4" />
        <span className="text-[10px] font-bold uppercase">Verified</span>
      </div>
    ) : (
      <div className="flex items-center gap-1 text-amber-500">
        <AlertTriangle className="w-4 h-4" />
        <span className="text-[10px] font-bold uppercase">Pending</span>
      </div>
    )}
  </div>
);

const GovStatCard: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <div className="p-6 bg-[#141414] rounded-2xl border border-white/10 shadow-xl">
    <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">{label}</span>
    <div className={cn("text-3xl font-bold mt-1", color)}>{value}</div>
  </div>
);

const ActivityRow: React.FC<{ time: string; action: string; actor: string; status: string }> = ({ time, action, actor, status }) => (
  <tr className="hover:bg-white/5 transition-colors">
    <td className="px-6 py-4 font-mono text-xs text-zinc-400">{time}</td>
    <td className="px-6 py-4 font-medium">{action}</td>
    <td className="px-6 py-4 text-zinc-400">{actor}</td>
    <td className="px-6 py-4">
      <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-500 text-[10px] font-bold uppercase rounded border border-emerald-500/20">{status}</span>
    </td>
  </tr>
);

export default Dashboard;
