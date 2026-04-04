import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Search, 
  Plus, 
  MapPin, 
  Calendar, 
  User as UserIcon, 
  LogOut, 
  LogIn, 
  Camera, 
  X, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  Trash2,
  Mic,
  MicOff,
  Sparkles,
  Volume2,
  Send,
  MessageSquare,
  ArrowRight,
  Gift,
  Coins,
  Video,
  Music,
  Share2,
  ExternalLink,
  Bell,
  Edit2,
  Settings,
  Globe,
  ChevronUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  where,
  deleteDoc,
  doc,
  updateDoc,
  getDoc,
  setDoc,
  Timestamp
} from 'firebase/firestore';
import { useAuthState } from 'react-firebase-hooks/auth';
import { format } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GoogleGenAI, Modality } from "@google/genai";
import { translations, Language } from './translations';

import { auth, db, signIn, logOut } from './firebase';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Types
interface FoundItem {
  id: string;
  title: string;
  description: string;
  location: string;
  imageUrl?: string;
  foundAt: Timestamp | Date;
  finderId: string;
  finderName: string;
  finderEmail: string;
  status: 'found' | 'claimed' | 'lost';
  type: 'found' | 'lost';
  reward?: string;
  createdAt: Timestamp;
  claimedBy?: string;
  claimedByName?: string;
  claimedAt?: Timestamp;
  claimAcknowledged?: boolean;
  claimedVia?: 'standard' | 'tiktok';
}

// Error Handler
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleFirestoreError(error: any, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  const errorJson = JSON.stringify(errInfo);
  console.error('Firestore Error: ', errorJson);
  throw new Error(errorJson);
}

// AI Service
let ai: GoogleGenAI | null = null;
try {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    ai = new GoogleGenAI({ apiKey });
  }
} catch (e) {
  console.error("Failed to initialize AI service:", e);
}

// Error Boundary Component
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="max-w-md w-full bg-white rounded-3xl p-8 shadow-xl border border-red-100">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-6">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <h1 className="text-2xl font-black text-gray-900 mb-4">Something went wrong</h1>
            <p className="text-gray-600 mb-6 font-medium">
              The application encountered an unexpected error. Please try refreshing the page.
            </p>
            <div className="bg-red-50 rounded-2xl p-4 mb-6 overflow-auto max-h-40">
              <code className="text-xs text-red-700 whitespace-pre-wrap">
                {this.state.error?.message || String(this.state.error)}
              </code>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-gray-900 text-white rounded-2xl font-bold hover:bg-gray-800 transition-colors"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function App() {
  console.log("Foundly App Mounting...");
  const [user, loadingAuth] = useAuthState(auth);
  const [items, setItems] = useState<FoundItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [filter, setFilter] = useState<'all' | 'my-posts'>('all');
  const [isScrolled, setIsScrolled] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [selectedItemForMap, setSelectedItemForMap] = useState<FoundItem | null>(null);
  const [selectedItemForDetail, setSelectedItemForDetail] = useState<FoundItem | null>(null);
  const [heroCity, setHeroCity] = useState<{ name: string, video: string, image: string } | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.play().catch(e => console.error("Manual play failed:", e));
    }
  }, [heroCity]);

  // AI State
  const [aiResponse, setAiResponse] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Form state
  const [newItem, setNewItem] = useState({
    title: '',
    description: '',
    location: '',
    imageUrl: '',
    type: 'found' as 'found' | 'lost',
    reward: '',
    pushToTikTok: false,
    imageFile: null as File | null,
  });
  const [submitting, setSubmitting] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [videoGenerationProgress, setVideoGenerationProgress] = useState('');
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [showKeySelection, setShowKeySelection] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [editingItem, setEditingItem] = useState<FoundItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [userSettings, setUserSettings] = useState({
    city: '',
    country: '',
    language: 'English',
    voiceEnabled: true
  });
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [activeSupportPage, setActiveSupportPage] = useState<string | null>(null);
  const seedingStarted = useRef(false);

  const t = translations[userSettings.language as Language] || translations.English;

  // Fetch user settings and ensure user document exists
  useEffect(() => {
    if (user) {
      const ensureUserDocAndFetchSettings = async () => {
        try {
          const userDocRef = doc(db, 'users', user.uid);
          const userDoc = await getDoc(userDocRef);
          
          if (!userDoc.exists()) {
            // Create user document if it doesn't exist
            await setDoc(userDocRef, {
              uid: user.uid,
              displayName: user.displayName,
              email: user.email,
              photoURL: user.photoURL,
              createdAt: serverTimestamp(),
              city: '',
              country: '',
              language: 'English'
            });
          } else {
            const data = userDoc.data();
            setUserSettings({
              city: data.city || '',
              country: data.country || '',
              language: data.language || 'English',
              voiceEnabled: data.voiceEnabled !== undefined ? data.voiceEnabled : true
            });
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
        }
      };
      ensureUserDocAndFetchSettings();
    }
  }, [user]);

  // Notifications logic
  const notifications = useMemo(() => {
    if (!user) return [];
    return items.filter(item => 
      item.finderId === user.uid && 
      item.status === 'claimed' && 
      !item.claimAcknowledged
    );
  }, [items, user]);

  const handleAcknowledgeClaim = async (itemId: string) => {
    try {
      await updateDoc(doc(db, 'items', itemId), {
        claimAcknowledged: true
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `items/${itemId}`);
    }
  };

  const createTestNotification = async (via: 'standard' | 'tiktok' = 'standard') => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'items'), {
        title: via === 'tiktok' ? 'Viral Item (TikTok)' : 'Test Found Item',
        description: via === 'tiktok' ? 'This item was found thanks to a viral TikTok video!' : 'This is a test notification item.',
        location: 'Test Location',
        finderId: user.uid,
        finderName: user.displayName || 'Me',
        finderEmail: user.email || '',
        status: 'claimed',
        type: 'found',
        claimedBy: 'test-user-id',
        claimedByName: via === 'tiktok' ? '@TikTokUser' : 'Test User',
        claimedAt: serverTimestamp(),
        claimAcknowledged: false,
        claimedVia: via,
        createdAt: serverTimestamp(),
        foundAt: new Date(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'items');
    }
  };

  // Fetch items
  useEffect(() => {
    const q = query(collection(db, 'items'), orderBy('createdAt', 'desc'));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedItems = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as FoundItem[];
      setItems(fetchedItems);
      setLoadingItems(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'items');
      setLoadingItems(false);
    });

    return () => unsubscribe();
  }, []);

  // Seed test items
  useEffect(() => {
    const seedItems = async () => {
      // Only seed if we have no items and the admin is logged in
      if (loadingItems || items.length > 0 || !user || user.email !== 'urbanstructure@gmail.com' || seedingStarted.current) return;

      seedingStarted.current = true;
      const testItems = [
        {
          title: 'Silver MacBook Pro 14"',
          description: 'Found a silver MacBook Pro on the N train near Union Square. It has a small sticker of a rocket on the lid. Seems to be in perfect condition.',
          location: 'Union Square Subway Station, NYC',
          imageUrl: 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=800&q=80',
          finderId: 'system',
          finderName: 'Foundly Team',
          finderEmail: 'team@foundly.app',
          status: 'found',
          type: 'found',
          createdAt: serverTimestamp(),
        },
        {
          title: 'Abandoned Black SUV (2022 Model)',
          description: 'Found a black SUV parked in a restricted zone for 3 days with windows slightly open. Reported to local authorities but posting here to find the owner.',
          location: 'Downtown Chicago, IL',
          imageUrl: 'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?auto=format&fit=crop&w=800&q=80',
          finderId: 'system',
          finderName: 'Urban Watch',
          finderEmail: 'watch@urban.org',
          status: 'found',
          type: 'found',
          createdAt: serverTimestamp(),
        },
        {
          title: 'Set of Callaway Golf Clubs',
          description: 'Found a full set of Callaway golf clubs in a black bag left near the parking lot of the public course.',
          location: 'Van Cortlandt Park, Bronx',
          imageUrl: 'https://images.unsplash.com/photo-1535131749006-b7f58c99034b?auto=format&fit=crop&w=800&q=80',
          finderId: 'system',
          finderName: 'Foundly Team',
          finderEmail: 'team@foundly.app',
          status: 'found',
          type: 'found',
          createdAt: serverTimestamp(),
        },
        {
          title: 'Lost Golden Retriever (Max)',
          description: 'Max went missing near Prospect Park. He is very friendly and wearing a blue collar. Offering a generous reward for his safe return!',
          location: 'Prospect Park, Brooklyn',
          imageUrl: 'https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=800&q=80',
          finderId: 'system',
          finderName: 'Sarah Jenkins',
          finderEmail: 'sarah@example.com',
          status: 'lost',
          type: 'lost',
          reward: '$500',
          createdAt: serverTimestamp(),
        },
        {
          title: 'Lost Shopping Bag (Designer Brand)',
          description: 'Lost a large shopping bag with several new items inside. Left it on the bus seat by mistake.',
          location: 'M15 Bus, Manhattan',
          imageUrl: 'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=800&q=80',
          finderId: 'system',
          finderName: 'Foundly Team',
          finderEmail: 'team@foundly.app',
          status: 'lost',
          type: 'lost',
          reward: '$50',
          createdAt: serverTimestamp(),
        }
      ];

      for (const item of testItems) {
        try {
          await addDoc(collection(db, 'items'), item);
        } catch (error) {
          console.error("Error seeding items:", error);
        }
      }
    };

    seedItems();
  }, [loadingItems, items.length, user]);

  // Scroll listener
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Random Hero City
  useEffect(() => {
    const cities = [
      {
        name: 'New York',
        video: 'https://drive.google.com/uc?id=1ZuEBsxQH7Ogvr7yxeWGveferfL07gnvX&export=media',
        image: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&w=1920&q=80'
      },
      {
        name: 'Chicago',
        video: 'https://assets.mixkit.co/videos/preview/mixkit-city-traffic-at-night-in-time-lapse-3146-large.mp4',
        image: 'https://images.unsplash.com/photo-1494522855154-9297ac14b55f?auto=format&fit=crop&w=1920&q=80'
      },
      {
        name: 'Tokyo',
        video: 'https://drive.google.com/uc?id=1ZuEBsxQH7Ogvr7yxeWGveferfL07gnvX&export=media',
        image: 'https://images.unsplash.com/photo-1542051841857-5f90071e7989?auto=format&fit=crop&w=1920&q=80'
      },
      {
        name: 'Paris',
        video: 'https://drive.google.com/uc?id=1ZuEBsxQH7Ogvr7yxeWGveferfL07gnvX&export=media',
        image: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=1920&q=80'
      }
    ];
    const randomCity = cities[Math.floor(Math.random() * cities.length)];
    setHeroCity(randomCity);
  }, []);

  // AI Interaction
  const askAi = async (query: string) => {
    if (!query.trim()) return;

    setIsAiLoading(true);
    setAiResponse('');
    
    try {
      const itemsContext = items.map(i => ({
        title: i.title,
        location: i.location,
        description: i.description,
        status: i.status,
        foundAt: i.createdAt ? format(i.createdAt.toDate(), 'MMM d, yyyy') : 'Unknown'
      }));

      const prompt = `You are Foundly AI, a helpful assistant for a lost and found platform. 
      We handle everything from small essentials like keys and wallets to major items like cars, golf clubs, and shopping bags.
      Current items in the database: ${JSON.stringify(itemsContext)}
      
      User question: "${query}"
      
      Help the user find their item or answer their question about the platform. Be concise and empathetic. 
      If they are looking for something specific, check the database and let them know if we have a match.
      
      IMPORTANT: Please respond in ${userSettings.language}.`;

      if (!ai) {
        setAiResponse("AI service is not configured. Please set the GEMINI_API_KEY environment variable.");
        return;
      }

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      const text = result.text;
      if (text) {
        setAiResponse(text);
        if (userSettings.voiceEnabled) {
          await speakText(text);
        }
      }
    } catch (error) {
      console.error("AI Error:", error);
      setAiResponse("Sorry, I encountered an error while processing your request.");
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleSearch = () => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    
    // If the query looks like a question or is long, ask the AI
    if (searchQuery.length > 10 || searchQuery.includes('?') || searchQuery.toLowerCase().includes('how') || searchQuery.toLowerCase().includes('where')) {
      askAi(searchQuery);
    }

    const resultsSection = document.getElementById('items-grid');
    if (resultsSection) {
      resultsSection.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Filtered items
  const filteredItems = useMemo(() => {
    let result = items;
    
    if (filter === 'my-posts' && user) {
      result = result.filter(item => item.finderId === user.uid);
    }

    if (searchQuery.trim()) {
      const queryStr = searchQuery.toLowerCase();
      result = result.filter(item => 
        item.title.toLowerCase().includes(queryStr) || 
        item.location.toLowerCase().includes(queryStr) ||
        item.description.toLowerCase().includes(queryStr)
      );
    }

    return result;
  }, [items, searchQuery, filter, user]);

  // Speech Recognition
  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert(t.speechNotSupported);
      return;
    }

    const langMap: Record<string, string> = {
      'English': 'en-US',
      'Spanish': 'es-ES',
      'French': 'fr-FR',
      'German': 'de-DE',
      'Chinese': 'zh-CN',
      'Japanese': 'ja-JP'
    };

    const recognition = new SpeechRecognition();
    recognition.lang = langMap[userSettings.language] || 'en-US';
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setSearchQuery(transcript);
      // Automatically trigger AI search for voice input
      askAi(transcript);
    };
    recognition.start();
  };



  const speakText = async (text: string) => {
    setIsSpeaking(true);
    try {
      // Map language names to BCP 47 tags for SpeechSynthesis
      const langMap: Record<string, string> = {
        'English': 'en-US',
        'Spanish': 'es-ES',
        'French': 'fr-FR',
        'German': 'de-DE',
        'Chinese': 'zh-CN',
        'Japanese': 'ja-JP'
      };

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = langMap[userSettings.language] || 'en-US';
      utterance.onend = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, 'tts');
      setIsSpeaking(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 800000) { // ~800KB limit for Firestore base64
        alert(t.imageTooLarge);
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setNewItem({ ...newItem, imageUrl: reader.result as string, imageFile: file });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCloseSettings = () => {
    setIsSettingsOpen(false);
    // Reset to current user data if not saved
    if (user) {
      const fetchSettings = async () => {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const data = userDoc.data();
          setUserSettings({
            city: data.city || '',
            country: data.country || '',
            language: data.language || 'English',
            voiceEnabled: data.voiceEnabled !== undefined ? data.voiceEnabled : true
          });
        }
      };
      fetchSettings();
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setIsSavingSettings(true);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        ...userSettings,
        updatedAt: serverTimestamp()
      });
      setIsSettingsOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleEditClick = (item: FoundItem) => {
    setEditingItem(item);
    setNewItem({
      title: item.title,
      description: item.description,
      location: item.location,
      imageUrl: item.imageUrl || '',
      type: item.type,
      reward: item.reward || '',
      pushToTikTok: false,
      imageFile: null,
    });
    setIsAddingItem(true);
  };

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setShowAuthModal(true);
      return;
    }

    setSubmitting(true);
    try {
      if (editingItem) {
        await updateDoc(doc(db, 'items', editingItem.id), {
          title: newItem.title,
          description: newItem.description,
          location: newItem.location,
          imageUrl: newItem.imageUrl,
          type: newItem.type,
          reward: newItem.reward,
          status: newItem.type === 'found' ? 'found' : 'lost',
          updatedAt: serverTimestamp(),
        });
        setIsAddingItem(false);
        setEditingItem(null);
        setNewItem({ title: '', description: '', location: '', imageUrl: '', type: 'found', reward: '', pushToTikTok: false, imageFile: null });
      } else {
        const docRef = await addDoc(collection(db, 'items'), {
          ...newItem,
          finderId: user.uid,
          finderName: user.displayName || 'Anonymous',
          finderEmail: user.email || '',
          status: newItem.type === 'found' ? 'found' : 'lost',
          foundAt: new Date(),
          createdAt: serverTimestamp(),
        });

        if (newItem.pushToTikTok) {
          await handleTikTokPush(newItem, docRef.id);
        } else {
          setIsAddingItem(false);
          setNewItem({ title: '', description: '', location: '', imageUrl: '', type: 'found', reward: '', pushToTikTok: false, imageFile: null });
        }
      }
    } catch (error) {
      handleFirestoreError(error, editingItem ? OperationType.UPDATE : OperationType.CREATE, editingItem ? `items/${editingItem.id}` : 'items');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTikTokPush = async (item: any, itemId: string) => {
    // @ts-ignore
    const hasKey = await window.aistudio.hasSelectedApiKey();
    if (!hasKey) {
      setShowKeySelection(true);
      return;
    }

    setIsGeneratingVideo(true);
    setVideoGenerationProgress(t.analyzingItem);
    
    try {
      const prompt = `A high-energy, viral-style TikTok video for a found item. 
      Item: ${item.title}. 
      Location: ${item.location}. 
      Description: ${item.description}. 
      The video should be fast-paced, urban, and helpful, showing the item in a cinematic way to help find the owner. 
      Text overlays: "${t.foundIn} ${item.location.toUpperCase()}" and "${t.helpUsFindOwner}"`;

      const aiInstance = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      setVideoGenerationProgress(t.generatingVideo);
      
      let operation = await aiInstance.models.generateVideos({
        model: 'veo-3.1-lite-generate-preview',
        prompt: prompt,
        config: {
          numberOfVideos: 1,
          resolution: '1080p',
          aspectRatio: '9:16'
        }
      });

      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        operation = await aiInstance.operations.getVideosOperation({ operation: operation });
      }

      const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (downloadLink && itemId !== 'temp-id') {
        const response = await fetch(downloadLink, {
          method: 'GET',
          headers: {
            'x-goog-api-key': process.env.GEMINI_API_KEY || '',
          },
        });
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setGeneratedVideoUrl(url);
        
        // Update Firestore with video URL
        await updateDoc(doc(db, 'items', itemId), {
          tiktokVideoUrl: url,
          pushedToTikTok: true
        });
      }

      setVideoGenerationProgress('Video posted to @FoundlyOfficial TikTok!');
      setTimeout(() => {
        setIsGeneratingVideo(false);
        setIsAddingItem(false);
        setNewItem({ title: '', description: '', location: '', imageUrl: '', type: 'found', reward: '', pushToTikTok: false, imageFile: null });
        setGeneratedVideoUrl(null);
      }, 3000);

    } catch (error) {
      console.error("TikTok Push Error:", error);
      setVideoGenerationProgress('Error generating video. Post saved locally.');
      setTimeout(() => setIsGeneratingVideo(false), 3000);
    }
  };

  const handleDeleteItem = async (id: string) => {
    setDeletingItem(id);
  };

  const confirmDelete = async () => {
    if (!deletingItem) return;
    try {
      await deleteDoc(doc(db, 'items', deletingItem));
      setDeletingItem(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `items/${deletingItem}`);
    }
  };

  const handleMarkAsClaimed = async (id: string) => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    try {
      await updateDoc(doc(db, 'items', id), { 
        status: 'claimed',
        claimedBy: user.uid,
        claimedByName: user.displayName,
        claimedAt: serverTimestamp()
      });
      setSelectedItemForMap(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `items/${id}`);
    }
  };

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-gray-50 text-gray-900 font-sans selection:bg-blue-100">
      {/* Header */}
      <header className={cn(
        "fixed top-0 z-40 w-full transition-all duration-300",
        isScrolled ? "bg-white/80 backdrop-blur-md border-b border-gray-100 h-16" : "bg-transparent h-20"
      )}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-lg transition-all",
              isScrolled ? "bg-blue-600 shadow-blue-200" : "bg-white/20 backdrop-blur-md shadow-none"
            )}>
              <Search className="w-6 h-6" />
            </div>
            <h1 className={cn(
              "text-2xl font-black tracking-tighter transition-colors",
              isScrolled ? "text-gray-900" : "text-white"
            )}>
              {t.appName}
            </h1>
          </div>

          <div className="flex items-center gap-4">
            <nav className="hidden md:flex items-center gap-1 bg-gray-100 p-1 rounded-xl">
              <button 
                onClick={() => setFilter('all')}
                className={cn(
                  "px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all",
                  filter === 'all' ? "bg-white text-blue-600 shadow-sm" : "text-gray-400 hover:text-gray-600"
                )}
              >
                {t.allItems}
              </button>
              <button 
                onClick={() => setFilter('my-posts')}
                className={cn(
                  "px-4 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all",
                  filter === 'my-posts' ? "bg-white text-blue-600 shadow-sm" : "text-gray-400 hover:text-gray-600"
                )}
              >
                {t.myPosts}
              </button>
            </nav>
            {user && (
              <div className="relative">
                <button 
                  onClick={() => setShowNotifications(!showNotifications)}
                  className={cn(
                    "p-2 rounded-xl transition-all relative",
                    isScrolled ? "hover:bg-gray-100 text-gray-600" : "hover:bg-gray-100 text-gray-600"
                  )}
                >
                  <Bell className="w-5 h-5" />
                  {notifications.length > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-600 text-white text-[10px] font-black rounded-full border-2 border-white flex items-center justify-center animate-bounce shadow-lg">
                      {notifications.length}
                    </span>
                  )}
                </button>

                <AnimatePresence>
                  {showNotifications && (
                    <>
                      <div 
                        className="fixed inset-0 z-[-1]" 
                        onClick={() => setShowNotifications(false)} 
                      />
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute right-0 mt-2 w-80 bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden"
                      >
                        <div className="p-4 border-b border-gray-50 flex items-center justify-between">
                          <h3 className="text-xs font-black uppercase tracking-widest text-gray-400">{t.notifications}</h3>
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => createTestNotification('standard')}
                              className="text-[10px] font-black text-gray-300 hover:text-blue-600 uppercase tracking-widest transition-colors"
                            >
                              Test
                            </button>
                            <button 
                              onClick={() => createTestNotification('tiktok')}
                              className="text-[10px] font-black text-gray-300 hover:text-pink-500 uppercase tracking-widest transition-colors"
                            >
                              TikTok
                            </button>
                            {notifications.length > 0 && (
                              <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[10px] font-black">
                                {notifications.length} {t.new}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="max-h-80 overflow-y-auto">
                          {notifications.length > 0 ? (
                            notifications.map(item => (
                              <div key={item.id} className="p-4 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0">
                                <div className="flex gap-3">
                                  <div className={cn(
                                    "w-10 h-10 rounded-xl flex items-center justify-center shrink-0",
                                    item.claimedVia === 'tiktok' ? "bg-pink-50 bg-opacity-50" : "bg-blue-50"
                                  )}>
                                    {item.claimedVia === 'tiktok' ? (
                                      <Share2 className="w-5 h-5 text-pink-500" />
                                    ) : (
                                      <CheckCircle2 className="w-5 h-5 text-blue-600" />
                                    )}
                                  </div>
                                  <div className="flex-1">
                                    <p className="text-xs font-bold text-gray-900 leading-snug">
                                      {item.claimedVia === 'tiktok' ? (
                                        <>
                                          <span className="text-pink-500 font-black">{t.tiktokViral}</span> <span className="text-gray-900">{item.claimedByName}</span> {t.foundThroughVideo} <span className="italic">"{item.title}"</span>
                                        </>
                                      ) : (
                                        <>
                                          <span className="text-blue-600">{item.claimedByName}</span> {t.claimedYourItem} <span className="italic">"{item.title}"</span>
                                        </>
                                      )}
                                    </p>
                                    <p className="text-[10px] text-gray-400 mt-1 font-medium">
                                      {item.claimedAt ? format(item.claimedAt.toDate(), 'MMM d, h:mm a') : t.justNow}
                                    </p>
                                    <button 
                                      onClick={() => handleAcknowledgeClaim(item.id)}
                                      className="mt-2 text-[10px] font-black text-blue-600 uppercase tracking-widest hover:underline"
                                    >
                                      {t.markAsRead}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="p-8 text-center">
                              <Bell className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{t.noNotifications}</p>
                            </div>
                          )}
                        </div>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            )}

            {user ? (
              <div className="flex items-center gap-3">
                <div className="hidden sm:block text-right">
                  <p className="text-sm font-bold text-gray-900">{user.displayName}</p>
                  <p className="text-xs text-gray-500">{user.email}</p>
                </div>
                <button 
                  onClick={() => setIsSettingsOpen(true)}
                  className={cn(
                    "p-2 rounded-full transition-colors",
                    isScrolled ? "hover:bg-gray-100 text-gray-500" : "hover:bg-white/10 text-white"
                  )}
                  title={t.userSettings}
                >
                  <Settings className="w-5 h-5" />
                </button>
                <button 
                  onClick={logOut}
                  className={cn(
                    "p-2 rounded-full transition-colors",
                    isScrolled ? "hover:bg-gray-100 text-gray-500" : "hover:bg-white/10 text-white"
                  )}
                  title={t.signOut}
                >
                  <LogOut className="w-5 h-5" />
                </button>
                <img 
                  src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} 
                  alt="Profile" 
                  className="w-10 h-10 rounded-full border-2 border-white shadow-sm"
                  referrerPolicy="no-referrer"
                />
              </div>
            ) : (
              <button 
                onClick={signIn}
                className={cn(
                  "flex items-center gap-2 px-6 py-2 rounded-xl font-bold transition-all shadow-lg",
                  isScrolled ? "bg-blue-600 text-white shadow-blue-100 hover:bg-blue-700" : "bg-white text-blue-600 shadow-none hover:bg-gray-50"
                )}
              >
                <LogIn className="w-4 h-4" />
                {t.signIn}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section with Prominent Search */}
      <section className="relative min-h-[80vh] flex items-center justify-center border-b border-gray-100 overflow-hidden">
        {/* Background Video & Fallback */}
        <div className="absolute inset-0 z-0 bg-gray-900">
          {heroCity && (
            <>
              <img 
                src={heroCity.image} 
                alt={`${heroCity.name} Urban Scene Fallback`} 
                className="absolute inset-0 w-full h-full object-cover opacity-60"
                referrerPolicy="no-referrer"
              />
              <video 
                ref={videoRef}
                key={heroCity.video}
                autoPlay 
                loop 
                muted 
                playsInline
                crossOrigin="anonymous"
                preload="auto"
                poster={heroCity.image}
                className="absolute inset-0 w-full h-full object-cover scale-105 animate-subtle-zoom opacity-100 z-0"
                onLoadedData={() => console.log("Video loaded successfully")}
                onError={(e) => console.error("Video failed to load", e)}
              >
                <source src={heroCity.video} type="video/mp4" />
                Your browser does not support the video tag.
              </video>
            </>
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-gray-900/70 via-gray-900/40 to-gray-50" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 md:py-32 relative z-10">
          <div className="text-center max-w-3xl mx-auto mb-12">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-2 px-4 py-1.5 bg-blue-500/20 backdrop-blur-md text-blue-100 rounded-full text-xs font-black uppercase tracking-[0.2em] mb-8 border border-white/10"
            >
              <Sparkles className="w-3 h-3" />
              {t.communityLostFound}
            </motion.div>
            <motion.h2 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="text-5xl md:text-8xl font-black text-white mb-8 leading-[0.9] tracking-tighter drop-shadow-2xl"
            >
              {t.heroTitle1} <br />
              <span className="text-blue-400">{t.heroTitle2}</span>
            </motion.h2>
            <motion.p 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="text-xl text-white/80 mb-12 font-medium max-w-2xl mx-auto leading-relaxed"
            >
              {t.heroSubtitle}
            </motion.p>
          </div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="max-w-3xl mx-auto relative group"
          >
            <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-blue-400 rounded-[2rem] blur opacity-30 group-hover:opacity-50 transition duration-1000 group-hover:duration-200" />
            <div className="relative flex flex-col md:flex-row items-center bg-white rounded-[2rem] shadow-2xl border border-gray-100 p-3 gap-2 mb-6">
              <div className="flex flex-1 items-center w-full">
                <Search className="w-6 h-6 text-gray-400 ml-4" />
                <input 
                  type="text" 
                  placeholder={t.searchPlaceholder}
                  className="flex-1 px-4 py-5 text-xl bg-transparent outline-none text-gray-900 placeholder:text-gray-400 font-medium"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 w-full md:w-auto border-t md:border-t-0 md:border-l border-gray-100 pt-2 md:pt-0 md:pl-2">
                <button 
                  onClick={startListening}
                  className={cn(
                    "p-4 rounded-2xl transition-all",
                    isListening ? "bg-red-50 text-red-600 animate-pulse" : "hover:bg-gray-50 text-gray-400"
                  )}
                  title={t.searchByVoice}
                >
                  {isListening ? <MicOff className="w-7 h-7" /> : <Mic className="w-7 h-7" />}
                </button>
                <button 
                  onClick={handleSearch}
                  className="flex-1 md:flex-none px-10 py-5 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 active:scale-95"
                >
                  {t.searchPlaceholder.split(' ')[0]}
                </button>
              </div>
            </div>

            {/* AI Response Area */}
            <AnimatePresence>
              {(isAiLoading || aiResponse) && (
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="mb-8 bg-white/90 backdrop-blur-xl p-6 rounded-[2rem] shadow-2xl border border-blue-100 text-left relative overflow-hidden"
                >
                  <div className="absolute top-0 left-0 w-1 h-full bg-blue-600" />
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-200">
                      <Sparkles className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="font-black text-blue-600 uppercase tracking-widest text-xs">{t.aiAssistant}</h3>
                        {aiResponse && (
                          <button 
                            onClick={() => setAiResponse('')}
                            className="p-1 hover:bg-gray-100 rounded-full transition-colors"
                          >
                            <X className="w-4 h-4 text-gray-400" />
                          </button>
                        )}
                      </div>
                      {isAiLoading ? (
                        <div className="space-y-2">
                          <div className="h-4 bg-gray-100 rounded-full w-full animate-pulse" />
                          <div className="h-4 bg-gray-100 rounded-full w-5/6 animate-pulse" />
                        </div>
                      ) : (
                        <p className="text-gray-700 text-lg font-medium leading-relaxed">
                          {aiResponse}
                        </p>
                      )}
                      {isSpeaking && (
                        <div className="mt-3 flex items-center gap-2 text-blue-600 text-[10px] font-bold uppercase tracking-widest">
                          <Volume2 className="w-3 h-3 animate-pulse" />
                          {t.speaking}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <span className="text-[10px] font-black text-white uppercase tracking-[0.3em] mr-2 self-center">{t.trending}:</span>
              {['Car', 'Keys', 'Golf Clubs', 'Shopping Bag', 'iPhone'].map(tag => (
                <button 
                  key={tag}
                  onClick={() => {
                    setSearchQuery(tag);
                    handleSearch();
                  }}
                  className="text-xs font-black uppercase tracking-widest px-5 py-2 bg-white text-gray-900 rounded-full hover:bg-gray-100 transition-all shadow-xl"
                >
                  {tag}
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      <main id="items-grid" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Filters and Actions */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 mb-10">
          <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-gray-200 shadow-sm">
            <button 
              onClick={() => setFilter('all')}
              className={cn(
                "px-6 py-2 rounded-lg font-bold text-sm transition-all",
                filter === 'all' ? "bg-gray-900 text-white shadow-md" : "text-gray-500 hover:bg-gray-50"
              )}
            >
              {t.allItems}
            </button>
            {user && (
              <button 
                onClick={() => setFilter('my-posts')}
                className={cn(
                  "px-6 py-2 rounded-lg font-bold text-sm transition-all",
                  filter === 'my-posts' ? "bg-gray-900 text-white shadow-md" : "text-gray-500 hover:bg-gray-50"
                )}
              >
                {t.myPosts}
              </button>
            )}
          </div>
          
          <button 
            onClick={() => user ? setIsAddingItem(true) : signIn()}
            className="w-full md:w-auto flex items-center justify-center gap-2 px-8 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-xl shadow-blue-100 group"
          >
            <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform" />
            {t.postNewItem}
          </button>
        </div>

        {/* Items Grid */}
        {loadingItems ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Loader2 className="w-10 h-10 animate-spin mb-4" />
            <p className="font-medium">{t.scanning}</p>
          </div>
        ) : filteredItems.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-8">
            <AnimatePresence>
              {filteredItems.map((item) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="group bg-white rounded-3xl border border-gray-100 overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-500 cursor-pointer flex flex-col"
                  onClick={() => setSelectedItemForDetail(item)}
                >
                  <div className="aspect-square bg-gray-50 relative overflow-hidden">
                    {item.imageUrl ? (
                      <img 
                        src={item.imageUrl} 
                        alt={item.title} 
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-gray-200">
                        <Camera className="w-12 h-12 mb-2" />
                        <span className="text-[8px] font-black uppercase tracking-[0.2em]">{t.noVisualData}</span>
                      </div>
                    )}
                    <div className="absolute top-3 left-3 flex flex-col gap-2">
                      <span className={cn(
                        "px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest shadow-lg backdrop-blur-md",
                        item.type === 'found' ? "bg-green-500/90 text-white" : "bg-orange-500/90 text-white"
                      )}>
                        {item.type === 'found' ? t.found : t.lost}
                      </span>
                      {item.reward && (
                        <span className="px-3 py-1 rounded-full bg-yellow-400 text-gray-900 text-[8px] font-black uppercase tracking-widest shadow-lg flex items-center gap-1">
                          <Gift className="w-2 h-2" />
                          {t.reward}: {item.reward}
                        </span>
                      )}
                    </div>
                    {user && item.finderId === user.uid && (
                      <div className="absolute top-3 right-3 flex flex-col gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditClick(item);
                          }}
                          className="p-2 bg-white/90 backdrop-blur-md rounded-full text-blue-600 shadow-lg hover:bg-white transition-all transform hover:scale-110"
                          title={t.editPost}
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteItem(item.id);
                          }}
                          className="p-2 bg-white/90 backdrop-blur-md rounded-full text-red-600 shadow-lg hover:bg-white transition-all transform hover:scale-110"
                          title={t.deletePost}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                  
                  <div className="p-4 bg-white flex-1 flex flex-col">
                    <h3 className="text-sm font-black text-gray-900 mb-1 line-clamp-1 group-hover:text-blue-600 transition-colors">{item.title}</h3>
                    <div className="mt-auto flex items-center gap-1.5 text-[10px] text-gray-400 font-bold uppercase tracking-tighter">
                      <MapPin className="w-3 h-3 text-blue-600 shrink-0" />
                      <span className="line-clamp-1">{item.location}</span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        ) : (
          <div className="text-center py-32 bg-white rounded-[3rem] border border-gray-100 shadow-sm">
            <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <Search className="w-12 h-12 text-gray-200" />
            </div>
            <h3 className="text-2xl font-black text-gray-900 mb-2">{t.nothingFound}</h3>
            <p className="text-gray-500 max-w-sm mx-auto font-medium">
              {t.nothingFoundSubtitle}
            </p>
          </div>
        )}
      </main>

      {/* Auth Modal */}
      <AnimatePresence>
        {showAuthModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAuthModal(false)}
              className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="relative h-48 overflow-hidden">
                <img 
                  src="https://images.unsplash.com/photo-1449034446853-66c86144b0ad?auto=format&fit=crop&w=800&q=80" 
                  alt="NYC Bridge" 
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent" />
                <button 
                  onClick={() => setShowAuthModal(false)}
                  className="absolute top-6 right-6 p-2 bg-white/20 backdrop-blur-md hover:bg-white/40 rounded-full text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="px-8 pb-10 pt-2 text-center">
                <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-blue-200 mx-auto -mt-12 relative z-10 mb-6">
                  <Search className="w-8 h-8" />
                </div>
                <h3 className="text-3xl font-black text-gray-900 mb-2 tracking-tight">{t.joinFoundly}</h3>
                <p className="text-gray-500 mb-8 font-medium">
                  {t.joinSubtitle}
                </p>

                <div className="space-y-4">
                  <button 
                    onClick={() => {
                      signIn();
                      setShowAuthModal(false);
                    }}
                    className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-white border-2 border-gray-100 rounded-2xl font-bold text-gray-700 hover:bg-gray-50 hover:border-blue-100 transition-all group active:scale-95"
                  >
                    <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
                    {t.continueWithGoogle}
                  </button>
                  
                  <div className="relative py-4">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-gray-100"></div>
                    </div>
                    <div className="relative flex justify-center text-xs uppercase tracking-widest font-black text-gray-400">
                      <span className="bg-white px-4">{t.orCreateAccount}</span>
                    </div>
                  </div>

                  <button 
                    className="w-full px-6 py-4 bg-gray-900 text-white rounded-2xl font-bold hover:bg-gray-800 transition-all shadow-xl shadow-gray-200 active:scale-95"
                    onClick={() => {
                      signIn();
                      setShowAuthModal(false);
                    }}
                  >
                    {t.createEmailAccount}
                  </button>
                </div>

                <p className="mt-8 text-xs text-gray-400 font-medium px-4">
                  {t.terms}
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {deletingItem && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setDeletingItem(null)}
              className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-sm bg-white rounded-[2.5rem] shadow-2xl overflow-hidden p-8 text-center"
            >
              <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center text-red-600 mx-auto mb-6">
                <Trash2 className="w-8 h-8" />
              </div>
              <h3 className="text-2xl font-black text-gray-900 mb-2">{t.deletePost}</h3>
              <p className="text-gray-500 mb-8 font-medium">
                {t.deleteConfirm}
              </p>
              <div className="flex gap-3">
                <button 
                  onClick={() => setDeletingItem(null)}
                  className="flex-1 px-6 py-4 bg-gray-100 text-gray-500 font-bold rounded-2xl hover:bg-gray-200 transition-all uppercase tracking-widest text-xs"
                >
                  {t.cancel}
                </button>
                <button 
                  onClick={confirmDelete}
                  className="flex-1 px-6 py-4 bg-red-600 text-white font-bold rounded-2xl hover:bg-red-700 transition-all shadow-xl shadow-red-100 uppercase tracking-widest text-xs"
                >
                  {t.delete}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Quick View Detail Modal */}
      <AnimatePresence>
        {selectedItemForDetail && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedItemForDetail(null)}
              className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-2xl bg-white rounded-[3rem] shadow-2xl overflow-hidden flex flex-col md:flex-row"
            >
              <div className="w-full md:w-1/2 aspect-square md:aspect-auto relative bg-gray-50">
                {selectedItemForDetail.imageUrl ? (
                  <img 
                    src={selectedItemForDetail.imageUrl} 
                    alt={selectedItemForDetail.title} 
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center text-gray-200">
                    <Camera className="w-16 h-16 mb-2" />
                    <span className="text-[10px] font-black uppercase tracking-[0.2em]">No Visual Data</span>
                  </div>
                )}
                <button 
                  onClick={() => setSelectedItemForDetail(null)}
                  className="absolute top-6 left-6 p-2 bg-white/80 backdrop-blur-md hover:bg-white rounded-full text-gray-900 shadow-lg transition-all md:hidden"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 p-8 flex flex-col">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm",
                      selectedItemForDetail.type === 'found' ? "bg-green-500 text-white" : "bg-orange-500 text-white"
                    )}>
                      {selectedItemForDetail.type === 'found' ? t.found : t.lost}
                    </span>
                    {selectedItemForDetail.reward && (
                      <span className="px-4 py-1.5 rounded-full bg-yellow-400 text-gray-900 text-[10px] font-black uppercase tracking-widest shadow-sm flex items-center gap-1.5">
                        <Gift className="w-3 h-3" />
                        {t.reward}: {selectedItemForDetail.reward}
                      </span>
                    )}
                  </div>
                  <button 
                    onClick={() => setSelectedItemForDetail(null)}
                    className="hidden md:block p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <h3 className="text-3xl font-black text-gray-900 mb-4 tracking-tight leading-tight">{selectedItemForDetail.title}</h3>
                
                <div className="space-y-4 mb-8">
                  <div className="flex items-center gap-3 text-sm text-gray-500">
                    <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center text-blue-600">
                      <MapPin className="w-4 h-4" />
                    </div>
                    <div className="flex-1 flex items-center justify-between">
                      <span className="font-bold">{selectedItemForDetail.location}</span>
                      <button 
                        onClick={() => {
                          setSelectedItemForMap(selectedItemForDetail);
                          setSelectedItemForDetail(null);
                        }}
                        className="text-[10px] font-black text-blue-600 uppercase tracking-widest hover:underline"
                      >
                        {t.viewMap}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-gray-500">
                    <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center text-purple-600">
                      <Calendar className="w-4 h-4" />
                    </div>
                    <span className="font-bold">{selectedItemForDetail.createdAt ? format(selectedItemForDetail.createdAt.toDate(), 'MMM d, yyyy') : t.justNow}</span>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-2xl p-6 mb-8">
                  <p className="text-sm text-gray-600 leading-relaxed font-medium">
                    {selectedItemForDetail.description || t.noDescription}
                  </p>
                </div>

                <div className="mt-auto flex flex-col gap-4">
                  <div className="flex items-center justify-between px-2">
                    <div className="flex items-center gap-3">
                      <img 
                        src={`https://ui-avatars.com/api/?name=${selectedItemForDetail.finderName}&background=random`} 
                        alt={selectedItemForDetail.finderName} 
                        className="w-8 h-8 rounded-full"
                      />
                      <div>
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{t.foundBy}</p>
                        <p className="text-sm font-bold text-gray-900">{selectedItemForDetail.finderName}</p>
                      </div>
                    </div>
                    
                    {user?.uid === selectedItemForDetail.finderId && (
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => {
                            handleEditClick(selectedItemForDetail);
                            setSelectedItemForDetail(null);
                          }}
                          className="p-2 text-blue-500 hover:bg-blue-50 rounded-xl transition-colors"
                          title={t.editPost}
                        >
                          <Edit2 className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => {
                            handleDeleteItem(selectedItemForDetail.id);
                            setSelectedItemForDetail(null);
                          }}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                          title={t.deletePost}
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {selectedItemForDetail.type === 'found' ? (
                    selectedItemForDetail.status === 'found' ? (
                      user?.uid !== selectedItemForDetail.finderId && (
                        <button 
                          onClick={() => {
                            handleMarkAsClaimed(selectedItemForDetail.id);
                            setSelectedItemForDetail(null);
                          }}
                          className="w-full py-5 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-blue-700 transition-all shadow-xl shadow-blue-100 active:scale-95 flex items-center justify-center gap-2"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          {t.claimItem}
                        </button>
                      )
                    ) : (
                      <div className="w-full py-5 bg-gray-100 text-gray-400 rounded-2xl font-black uppercase tracking-widest text-xs text-center flex items-center justify-center gap-2">
                        <CheckCircle2 className="w-4 h-4" />
                        {t.alreadyClaimed}
                      </div>
                    )
                  ) : (
                    user?.uid !== selectedItemForDetail.finderId && (
                      <button 
                        onClick={() => {
                          window.location.href = `mailto:${selectedItemForDetail.finderEmail}?subject=Found your item: ${selectedItemForDetail.title}`;
                        }}
                        className="w-full py-5 bg-orange-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-orange-700 transition-all shadow-xl shadow-orange-100 active:scale-95 flex items-center justify-center gap-2"
                      >
                        <Send className="w-4 h-4" />
                        {t.contactOwner}
                      </button>
                    )
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Map Modal */}
      <AnimatePresence>
        {selectedItemForMap && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedItemForMap(null)}
              className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-4xl bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col md:flex-row h-[80vh] md:h-[600px]"
            >
              <div className="flex-1 relative bg-gray-100">
                {import.meta.env.VITE_GOOGLE_MAPS_API_KEY ? (
                  <a 
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(selectedItemForMap.location + ' New York')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full h-full relative group cursor-pointer"
                  >
                    <img 
                      src={`https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(selectedItemForMap.location + ' New York')}&zoom=15&size=800x600&scale=2&maptype=roadmap&markers=color:red%7C${encodeURIComponent(selectedItemForMap.location + ' New York')}&key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}`}
                      alt="Location Map"
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                      <div className="bg-white/90 backdrop-blur-md px-4 py-2 rounded-full shadow-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2">
                        <ExternalLink className="w-4 h-4 text-blue-600" />
                        <span className="text-xs font-black uppercase tracking-widest text-gray-900">Open in Google Maps</span>
                      </div>
                    </div>
                  </a>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
                    <MapPin className="w-12 h-12 text-gray-300 mb-4" />
                    <h3 className="text-lg font-bold text-gray-900 mb-2">Google Maps Key Missing</h3>
                    <p className="text-sm text-gray-500 max-w-xs">
                      Please add your <code className="bg-gray-200 px-1 rounded">VITE_GOOGLE_MAPS_API_KEY</code> to the Secrets panel in the Settings menu to enable map views.
                    </p>
                  </div>
                )}
                <button 
                  onClick={() => setSelectedItemForMap(null)}
                  className="absolute top-6 left-6 p-2 bg-white/80 backdrop-blur-md hover:bg-white rounded-full text-gray-900 shadow-lg transition-all md:hidden"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="w-full md:w-80 p-8 flex flex-col">
                <div className="flex items-center justify-between mb-6">
                  <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-200">
                    <MapPin className="w-6 h-6" />
                  </div>
                  <button 
                    onClick={() => setSelectedItemForMap(null)}
                    className="hidden md:block p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <h3 className="text-2xl font-black text-gray-900 mb-2 tracking-tight">{selectedItemForMap.title}</h3>
                <p className="text-gray-500 mb-6 text-sm font-medium leading-relaxed">
                  {selectedItemForMap.description || 'No description provided.'}
                </p>

                <div className="space-y-4 mb-8">
                  <div className="flex items-center gap-3 text-sm text-gray-500">
                    <MapPin className="w-4 h-4 text-blue-600" />
                    <span className="font-bold">{selectedItemForMap.location}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-gray-500">
                    <Calendar className="w-4 h-4 text-purple-600" />
                    <span className="font-bold">{format(selectedItemForMap.createdAt.toDate(), 'MMM d, yyyy')}</span>
                  </div>
                </div>

                <div className="mt-auto">
                  {selectedItemForMap.status === 'found' ? (
                    user?.uid !== selectedItemForMap.finderId && (
                      <button 
                        onClick={() => handleMarkAsClaimed(selectedItemForMap.id)}
                        className="w-full py-4 bg-green-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-green-700 transition-all shadow-xl shadow-green-100 active:scale-95 flex items-center justify-center gap-2"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        {t.claimItem}
                      </button>
                    )
                  ) : (
                    <div className="w-full py-4 bg-gray-100 text-gray-400 rounded-2xl font-black uppercase tracking-widest text-xs text-center flex items-center justify-center gap-2">
                      <CheckCircle2 className="w-4 h-4" />
                      {t.alreadyClaimed}
                    </div>
                  )}
                  <p className="mt-4 text-[10px] text-gray-400 text-center font-bold uppercase tracking-widest leading-relaxed">
                    {t.foundBy} {selectedItemForMap.finderName}
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={() => handleCloseSettings()}
              className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="px-8 py-6 border-b border-gray-50 flex items-center justify-between">
                <h2 className="text-2xl font-black">{t.userSettings}</h2>
                <button 
                  onClick={handleCloseSettings}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleSaveSettings} className="p-8 space-y-6">
                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">{t.currentCity}</label>
                  <div className="relative">
                    <MapPin className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input 
                      type="text" 
                      placeholder={t.cityPlaceholder}
                      className="w-full pl-14 pr-6 py-4 bg-gray-50 border border-transparent rounded-2xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                      value={userSettings.city}
                      onChange={(e) => setUserSettings({ ...userSettings, city: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">{t.country}</label>
                  <div className="relative">
                    <Globe className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input 
                      type="text" 
                      placeholder={t.countryPlaceholder}
                      className="w-full pl-14 pr-6 py-4 bg-gray-50 border border-transparent rounded-2xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                      value={userSettings.country}
                      onChange={(e) => setUserSettings({ ...userSettings, country: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">{t.preferredLanguage}</label>
                  <select 
                    className="w-full px-6 py-4 bg-gray-50 border border-transparent rounded-2xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium appearance-none"
                    value={userSettings.language}
                    onChange={(e) => setUserSettings({ ...userSettings, language: e.target.value })}
                  >
                    <option value="English">English</option>
                    <option value="Spanish">Spanish</option>
                    <option value="French">French</option>
                    <option value="German">German</option>
                    <option value="Chinese">Chinese</option>
                    <option value="Japanese">Japanese</option>
                  </select>
                </div>

                <div className="pt-2">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <div className="relative">
                      <input 
                        type="checkbox" 
                        className="sr-only peer"
                        checked={userSettings.voiceEnabled}
                        onChange={(e) => setUserSettings({ ...userSettings, voiceEnabled: e.target.checked })}
                      />
                      <div className="w-12 h-6 bg-gray-200 rounded-full peer peer-checked:bg-blue-600 transition-all after:content-[''] after:absolute after:top-1 after:left-1 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-6" />
                    </div>
                    <span className="text-sm font-bold text-gray-700 group-hover:text-blue-600 transition-colors">{t.aiVoiceResponses}</span>
                  </label>
                </div>

                <div className="pt-4">
                  <button 
                    disabled={isSavingSettings}
                    className="w-full py-5 bg-blue-600 text-white rounded-2xl font-black uppercase tracking-widest text-sm hover:bg-blue-700 transition-all shadow-2xl shadow-blue-100 disabled:opacity-50 active:scale-95 flex items-center justify-center gap-3"
                  >
                    {isSavingSettings ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-5 h-5" />
                    )}
                    {t.saveSettings}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Item Modal */}
      <AnimatePresence>
        {isAddingItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setIsAddingItem(false);
                setEditingItem(null);
                setNewItem({ title: '', description: '', location: '', imageUrl: '', type: 'found', reward: '', pushToTikTok: false, imageFile: null });
              }}
              className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
              <div className="px-8 py-6 border-b border-gray-50 flex items-center justify-between">
                <h2 className="text-2xl font-black">{editingItem ? t.editPost : t.postNewItem}</h2>
                <button 
                  onClick={() => {
                    setIsAddingItem(false);
                    setEditingItem(null);
                    setNewItem({ title: '', description: '', location: '', imageUrl: '', type: 'found', reward: '', pushToTikTok: false, imageFile: null });
                  }}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleAddItem} className="p-8 space-y-6">
                <div className="flex p-1 bg-gray-100 rounded-2xl">
                  <button
                    type="button"
                    onClick={() => setNewItem({ ...newItem, type: 'found' })}
                    className={cn(
                      "flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
                      newItem.type === 'found' ? "bg-white text-blue-600 shadow-sm" : "text-gray-400 hover:text-gray-600"
                    )}
                  >
                    {t.iFoundSomething}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewItem({ ...newItem, type: 'lost' })}
                    className={cn(
                      "flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
                      newItem.type === 'lost' ? "bg-white text-orange-600 shadow-sm" : "text-gray-400 hover:text-gray-600"
                    )}
                  >
                    {t.iLostSomething}
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">{t.itemTitle} *</label>
                  <input 
                    required
                    type="text" 
                    placeholder={newItem.type === 'found' ? t.itemTitlePlaceholderFound : t.itemTitlePlaceholderLost}
                    className="w-full px-6 py-4 bg-gray-50 border border-transparent rounded-2xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                    value={newItem.title}
                    onChange={(e) => setNewItem({ ...newItem, title: e.target.value })}
                  />
                </div>

                {newItem.type === 'lost' && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                  >
                    <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">{t.rewardOptional}</label>
                    <div className="relative">
                      <Gift className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-yellow-500" />
                      <input 
                        type="text" 
                        placeholder={t.rewardPlaceholder}
                        className="w-full pl-14 pr-6 py-4 bg-gray-50 border border-transparent rounded-2xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                        value={newItem.reward}
                        onChange={(e) => setNewItem({ ...newItem, reward: e.target.value })}
                      />
                    </div>
                  </motion.div>
                )}

                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">
                    {newItem.type === 'found' ? t.whereFound : t.whereLost}
                  </label>
                  <div className="relative">
                    <MapPin className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input 
                      required
                      type="text" 
                      placeholder={t.wherePlaceholder}
                      className="w-full pl-14 pr-6 py-4 bg-gray-50 border border-transparent rounded-2xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium"
                      value={newItem.location}
                      onChange={(e) => setNewItem({ ...newItem, location: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">{t.description}</label>
                  <textarea 
                    rows={3}
                    placeholder={t.descriptionPlaceholder}
                    className="w-full px-6 py-4 bg-gray-50 border border-transparent rounded-2xl focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all font-medium resize-none"
                    value={newItem.description}
                    onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-black text-gray-400 uppercase tracking-widest mb-2">{t.itemPhoto}</label>
                  <div className="space-y-4">
                    {newItem.imageUrl ? (
                      <div className="relative w-full aspect-video rounded-2xl overflow-hidden group">
                        <img 
                          src={newItem.imageUrl} 
                          alt="Preview" 
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                        <button 
                          type="button"
                          onClick={() => setNewItem({ ...newItem, imageUrl: '', imageFile: null })}
                          className="absolute top-4 right-4 p-2 bg-white/90 backdrop-blur-md rounded-full text-red-600 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <label className="flex flex-col items-center justify-center w-full aspect-video bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl cursor-pointer hover:bg-gray-100 hover:border-blue-500 transition-all group">
                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                          <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-sm mb-3 group-hover:scale-110 transition-transform">
                            <Camera className="w-6 h-6 text-blue-600" />
                          </div>
                          <p className="text-sm font-bold text-gray-900">{t.clickToUpload}</p>
                          <p className="text-[10px] text-gray-400 font-black uppercase tracking-widest mt-1">{t.photoFormats}</p>
                        </div>
                        <input 
                          type="file" 
                          className="hidden" 
                          accept="image/*"
                          onChange={handleFileChange}
                        />
                      </label>
                    )}
                  </div>
                </div>

                <div className="p-6 bg-gradient-to-br from-gray-900 to-gray-800 rounded-[2rem] border border-white/5 shadow-xl">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center">
                        <Share2 className="w-5 h-5 text-pink-500" />
                      </div>
                      <div>
                        <h4 className="text-sm font-black text-white uppercase tracking-widest">{t.tiktokViralPush}</h4>
                        <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tighter">{t.aiGeneratedVideo}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setNewItem({ ...newItem, pushToTikTok: !newItem.pushToTikTok })}
                      className={cn(
                        "w-12 h-6 rounded-full transition-all relative",
                        newItem.pushToTikTok ? "bg-pink-500" : "bg-gray-700"
                      )}
                    >
                      <div className={cn(
                        "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                        newItem.pushToTikTok ? "left-7" : "left-1"
                      )} />
                    </button>
                  </div>
                  <p className="text-[10px] text-gray-400 leading-relaxed font-medium">
                    {t.tiktokDescription}
                  </p>
                </div>

                <div className="pt-4 flex gap-4">
                  <button 
                    type="button"
                    onClick={() => {
                      setIsAddingItem(false);
                      setEditingItem(null);
                      setNewItem({ title: '', description: '', location: '', imageUrl: '', type: 'found', reward: '', pushToTikTok: false, imageFile: null });
                    }}
                    className="flex-1 px-6 py-4 border border-gray-100 text-gray-500 font-bold rounded-2xl hover:bg-gray-50 transition-all uppercase tracking-widest text-xs"
                  >
                    {t.cancel}
                  </button>
                  <button 
                    type="submit"
                    disabled={submitting}
                    className="flex-1 px-6 py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-xl shadow-blue-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 uppercase tracking-widest text-xs"
                  >
                    {submitting ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      editingItem ? t.updatePost : t.postItem
                    )}
                  </button>
                </div>
              </form>

              {/* Video Generation Overlay */}
              <AnimatePresence>
                {isGeneratingVideo && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-gray-900/95 backdrop-blur-xl z-50 flex flex-col items-center justify-center p-8 text-center"
                  >
                    <div className="relative mb-8">
                      <div className="w-24 h-24 border-4 border-pink-500/20 border-t-pink-500 rounded-full animate-spin" />
                      <Video className="absolute inset-0 m-auto w-8 h-8 text-pink-500 animate-pulse" />
                    </div>
                    <h3 className="text-2xl font-black text-white mb-2 tracking-tight">Generating Viral Video</h3>
                    <p className="text-gray-400 text-sm font-medium max-w-xs mx-auto mb-8">
                      {videoGenerationProgress}
                    </p>
                    {generatedVideoUrl && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="w-full aspect-[9/16] max-h-64 bg-black rounded-2xl overflow-hidden mb-6 border border-white/10"
                      >
                        <video src={generatedVideoUrl} autoPlay loop muted className="w-full h-full object-cover" />
                      </motion.div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* API Key Selection Overlay */}
              <AnimatePresence>
                {showKeySelection && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-gray-900/95 backdrop-blur-xl z-50 flex flex-col items-center justify-center p-8 text-center"
                  >
                    <div className="w-16 h-16 bg-blue-500/20 rounded-2xl flex items-center justify-center mb-6">
                      <ExternalLink className="w-8 h-8 text-blue-500" />
                    </div>
                    <h3 className="text-2xl font-black text-white mb-4 tracking-tight">API Key Required</h3>
                    <p className="text-gray-400 text-sm font-medium mb-8">
                      To generate AI videos for TikTok, you need to select a paid Gemini API key. 
                      This ensures high-quality cinematic generation.
                    </p>
                    <div className="flex flex-col gap-3 w-full">
                      <button 
                        onClick={async () => {
                          // @ts-ignore
                          await window.aistudio.openSelectKey();
                          setShowKeySelection(false);
                          // We don't retry with temp-id here, the user should just re-submit the form if it failed
                          // or we could store the pending item ID in a ref
                        }}
                        className="w-full py-4 bg-blue-600 text-white rounded-xl font-black uppercase tracking-widest text-xs hover:bg-blue-700 transition-all"
                      >
                        Select API Key
                      </button>
                      <button 
                        onClick={() => {
                          setShowKeySelection(false);
                          setIsAddingItem(false);
                        }}
                        className="w-full py-4 bg-white/10 text-white rounded-xl font-black uppercase tracking-widest text-xs hover:bg-white/20 transition-all"
                      >
                        Skip for now
                      </button>
                    </div>
                    <a 
                      href="https://ai.google.dev/gemini-api/docs/billing" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="mt-6 text-[10px] text-gray-500 hover:text-blue-400 uppercase font-black tracking-widest"
                    >
                      Learn about billing
                    </a>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Support Pages Modal */}
      <AnimatePresence>
        {activeSupportPage && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveSupportPage(null)}
              className="absolute inset-0 bg-gray-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-3xl bg-white rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="p-8 border-b border-gray-100 flex items-center justify-between bg-white sticky top-0 z-10">
                <div>
                  <h3 className="text-2xl font-black text-gray-900 tracking-tight">{activeSupportPage}</h3>
                  <p className="text-xs font-bold text-blue-600 uppercase tracking-widest mt-1">Foundly Support</p>
                </div>
                <button 
                  onClick={() => setActiveSupportPage(null)}
                  className="p-3 hover:bg-gray-100 rounded-2xl text-gray-400 transition-all active:scale-90"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-8 md:p-12 custom-scrollbar">
                <div className="prose prose-blue max-w-none">
                  {activeSupportPage === 'Privacy Policy' && (
                    <div className="space-y-8">
                      <section>
                        <h4 className="text-lg font-black text-gray-900 mb-4 uppercase tracking-wider">1. Information We Collect</h4>
                        <p className="text-gray-600 leading-relaxed font-medium">
                          We collect information you provide directly to us, such as when you create an account, post an item, or communicate with other users. This includes your name, email address, profile photo, and any location data associated with your posts.
                        </p>
                      </section>
                      <section>
                        <h4 className="text-lg font-black text-gray-900 mb-4 uppercase tracking-wider">2. How We Use Your Information</h4>
                        <p className="text-gray-600 leading-relaxed font-medium">
                          We use the information we collect to facilitate the return of lost items, improve our services, and communicate with you about your account or viral pushes for your found items.
                        </p>
                      </section>
                      <section>
                        <h4 className="text-lg font-black text-gray-900 mb-4 uppercase tracking-wider">3. Sharing of Information</h4>
                        <p className="text-gray-600 leading-relaxed font-medium">
                          Your public profile information and the details of items you post (including location) are visible to other users. We do not sell your personal data to third parties.
                        </p>
                      </section>
                      <section>
                        <h4 className="text-lg font-black text-gray-900 mb-4 uppercase tracking-wider">4. Data Security</h4>
                        <p className="text-gray-600 leading-relaxed font-medium">
                          We take reasonable measures to help protect information about you from loss, theft, misuse, and unauthorized access.
                        </p>
                      </section>
                    </div>
                  )}

                  {activeSupportPage === 'Terms of Service' && (
                    <div className="space-y-8">
                      <section>
                        <h4 className="text-lg font-black text-gray-900 mb-4 uppercase tracking-wider">1. Acceptance of Terms</h4>
                        <p className="text-gray-600 leading-relaxed font-medium">
                          By accessing or using Foundly, you agree to be bound by these Terms of Service and all applicable laws and regulations.
                        </p>
                      </section>
                      <section>
                        <h4 className="text-lg font-black text-gray-900 mb-4 uppercase tracking-wider">2. User Conduct</h4>
                        <p className="text-gray-600 leading-relaxed font-medium">
                          You are responsible for your use of the service and for any content you provide. You agree not to post false information, harass other users, or use the service for any illegal purposes.
                        </p>
                      </section>
                      <section>
                        <h4 className="text-lg font-black text-gray-900 mb-4 uppercase tracking-wider">3. Item Ownership</h4>
                        <p className="text-gray-600 leading-relaxed font-medium">
                          Foundly does not take possession of items. We are a platform to facilitate connections. Users are responsible for verifying ownership before returning items.
                        </p>
                      </section>
                      <section>
                        <h4 className="text-lg font-black text-gray-900 mb-4 uppercase tracking-wider">4. Limitation of Liability</h4>
                        <p className="text-gray-600 leading-relaxed font-medium">
                          Foundly is not liable for any damages arising from your use of the service or from interactions between users.
                        </p>
                      </section>
                    </div>
                  )}

                  {activeSupportPage === 'Safety Tips' && (
                    <div className="space-y-8">
                      <div className="bg-blue-50 p-6 rounded-3xl border border-blue-100 mb-8">
                        <p className="text-blue-700 font-bold flex items-center gap-2">
                          <AlertCircle className="w-5 h-5" />
                          Your safety is our top priority.
                        </p>
                      </div>
                      <section>
                        <h4 className="text-lg font-black text-gray-900 mb-4 uppercase tracking-wider">1. Meet in Public</h4>
                        <p className="text-gray-600 leading-relaxed font-medium">
                          Always arrange to meet in a well-lit, busy public place, such as a coffee shop, police station lobby, or shopping mall.
                        </p>
                      </section>
                      <section>
                        <h4 className="text-lg font-black text-gray-900 mb-4 uppercase tracking-wider">2. Bring a Friend</h4>
                        <p className="text-gray-600 leading-relaxed font-medium">
                          If possible, bring a friend or family member with you to the meeting.
                        </p>
                      </section>
                      <section>
                        <h4 className="text-lg font-black text-gray-900 mb-4 uppercase tracking-wider">3. Verify Ownership</h4>
                        <p className="text-gray-600 leading-relaxed font-medium">
                          Ask the claimant for specific details about the item that weren't in the public post (e.g., serial numbers, unique marks, or what's inside a bag).
                        </p>
                      </section>
                      <section>
                        <h4 className="text-lg font-black text-gray-900 mb-4 uppercase tracking-wider">4. Trust Your Gut</h4>
                        <p className="text-gray-600 leading-relaxed font-medium">
                          If a situation feels uncomfortable or suspicious, leave immediately and report the user to our support team.
                        </p>
                      </section>
                    </div>
                  )}

                  {activeSupportPage === 'Contact Us' && (
                    <div className="space-y-8">
                      <p className="text-gray-600 leading-relaxed font-medium text-lg">
                        Have questions or need assistance? Our team is here to help you reunite with your belongings.
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="p-6 bg-gray-50 rounded-3xl border border-gray-100">
                          <h5 className="font-black text-gray-900 uppercase tracking-widest text-xs mb-4">Email Support</h5>
                          <p className="text-blue-600 font-bold text-lg">support@foundly.app</p>
                          <p className="text-gray-500 text-sm mt-2">Response within 24 hours</p>
                        </div>
                        <div className="p-6 bg-gray-50 rounded-3xl border border-gray-100">
                          <h5 className="font-black text-gray-900 uppercase tracking-widest text-xs mb-4">Press Inquiries</h5>
                          <p className="text-blue-600 font-bold text-lg">press@foundly.app</p>
                          <p className="text-gray-500 text-sm mt-2">For media and viral push requests</p>
                        </div>
                      </div>
                      <div className="p-8 bg-blue-600 rounded-3xl text-white shadow-xl shadow-blue-100">
                        <h5 className="font-black uppercase tracking-widest text-xs mb-4 opacity-80">Office Location</h5>
                        <p className="text-xl font-bold">Foundly HQ</p>
                        <p className="opacity-90 mt-2">123 Community Way, Tech District<br />New York, NY 10001</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="p-8 bg-gray-50 border-t border-gray-100 flex justify-center">
                <button 
                  onClick={() => setActiveSupportPage(null)}
                  className="px-12 py-4 bg-gray-900 text-white font-black uppercase tracking-[0.2em] text-xs rounded-2xl hover:bg-gray-800 transition-all active:scale-95 shadow-xl shadow-gray-200"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <footer className="bg-white border-t border-gray-100 py-20 mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
            <div className="col-span-1 md:col-span-2">
              <div className="flex items-center gap-2 mb-6">
                <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white">
                  <Search className="w-6 h-6" />
                </div>
                <span className="text-2xl font-black tracking-tighter">Foundly</span>
              </div>
              <p className="text-gray-500 max-w-sm leading-relaxed font-medium">
                Foundly is a community-driven platform dedicated to reuniting people with their lost belongings. 
                Built with empathy and powered by AI.
              </p>
            </div>
            
            <div>
              <h4 className="text-xs font-black text-gray-900 uppercase tracking-[0.2em] mb-6">Platform</h4>
              <ul className="space-y-4 text-sm font-bold text-gray-500">
                <li><a href="#" className="hover:text-blue-600 transition-colors">Search Items</a></li>
                <li><a href="#" className="hover:text-blue-600 transition-colors">Post Found Item</a></li>
                <li><a href="#" className="hover:text-blue-600 transition-colors">How it Works</a></li>
                <li><a href="#" className="hover:text-blue-600 transition-colors">Success Stories</a></li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-black text-gray-900 uppercase tracking-[0.2em] mb-6">Support</h4>
              <ul className="space-y-4 text-sm font-bold text-gray-500">
                <li><button onClick={() => setActiveSupportPage('Privacy Policy')} className="hover:text-blue-600 transition-colors">Privacy Policy</button></li>
                <li><button onClick={() => setActiveSupportPage('Terms of Service')} className="hover:text-blue-600 transition-colors">Terms of Service</button></li>
                <li><button onClick={() => setActiveSupportPage('Safety Tips')} className="hover:text-blue-600 transition-colors">Safety Tips</button></li>
                <li><button onClick={() => setActiveSupportPage('Contact Us')} className="hover:text-blue-600 transition-colors">Contact Us</button></li>
              </ul>
            </div>
          </div>

          <div className="pt-12 border-t border-gray-50 flex flex-col md:flex-row justify-between items-center gap-6">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
              © {new Date().getFullYear()} Foundly. Made with ❤️ for the community.
            </p>
            <div className="flex items-center gap-6">
              <button 
                onClick={scrollToTop}
                className="flex items-center gap-3 group transition-all duration-300 hover:-translate-y-1"
                title="Back to top"
              >
                <span className="text-[11px] font-black uppercase tracking-widest text-blue-600 group-hover:text-blue-700 transition-colors">Back to top</span>
                <div className="w-14 h-14 rounded-full bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-200 group-hover:bg-blue-700 group-hover:shadow-xl group-hover:shadow-blue-300 transition-all">
                  <ChevronUp className="w-6 h-6 stroke-[3px]" />
                </div>
              </button>
              {/* Social placeholders */}
              <div className="w-8 h-8 rounded-full bg-gray-50 hover:bg-blue-50 transition-colors cursor-pointer" />
              <div className="w-8 h-8 rounded-full bg-gray-50 hover:bg-blue-50 transition-colors cursor-pointer" />
            </div>
          </div>
        </div>
      </footer>
    </div>
  </ErrorBoundary>
);
}
