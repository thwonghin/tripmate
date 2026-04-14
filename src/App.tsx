import { useState, useEffect, useMemo } from 'react';
import { 
  Plus, 
  Calendar as CalendarIcon, 
  DollarSign, 
  MapPin, 
  Clock, 
  Trash2, 
  ChevronRight, 
  PieChart as PieChartIcon,
  LogOut,
  Plane,
  Hotel,
  Utensils,
  Activity,
  Car,
  ChevronLeft,
  ArrowRight,
  Users,
  Share2,
  Pencil
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, addDays, startOfDay, isSameDay, parseISO, isBefore, addHours, isWithinInterval, endOfDay } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { 
  collection,
  addDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  deleteDoc,
  doc,
  Timestamp,
  updateDoc,
  or,
  setDoc,
  getDocs,
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User 
} from 'firebase/auth';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip as RechartsTooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid
} from 'recharts';
import { Toaster, toast } from 'sonner';

import { db, auth, handleFirestoreError, OperationType } from './firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// --- Types ---

interface Trip {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  budget: number;
  baseCurrency: string;
  ownerId: string;
  collaboratorEmails?: string[];
  collaboratorIds?: string[];
}

interface ItineraryItem {
  id: string;
  tripId: string;
  title: string;
  startTime: Date;
  endTime?: Date;
  location: string;
  notes: string;
  type: 'flight' | 'hotel' | 'activity' | 'transport' | 'food';
}

interface Expense {
  id: string;
  tripId: string;
  amount: number;
  currency: string;
  category: 'transport' | 'food' | 'accommodation' | 'shopping' | 'other';
  description: string;
  date: Date;
}

// --- Constants ---

const CURRENCIES = [
  'USD', 'HKD', 'TWD', 'JPY', 'EUR', 'GBP', 'AUD', 'CAD', 'SGD', 'CNY', 
  'KRW', 'THB', 'MOP', 'MYR', 'VND', 'PHP', 'IDR', 'CHF', 'NZD'
];

const CATEGORY_COLORS = {
  transport: '#3b82f6',
  food: '#ef4444',
  accommodation: '#10b981',
  shopping: '#f59e0b',
  other: '#6366f1',
};

const CATEGORY_LABELS = {
  transport: '交通',
  food: '餐飲',
  accommodation: '住宿',
  shopping: '購物',
  other: '其他',
};

const TYPE_LABELS = {
  flight: '航班',
  hotel: '酒店/住宿',
  activity: '活動',
  transport: '交通',
  food: '餐飲',
};

const TYPE_ICONS = {
  flight: <Plane className="w-4 h-4" />,
  hotel: <Hotel className="w-4 h-4" />,
  activity: <Activity className="w-4 h-4" />,
  transport: <Car className="w-4 h-4" />,
  food: <Utensils className="w-4 h-4" />,
};

// --- Components ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedTrip, setSelectedTrip] = useState<Trip | null>(null);
  const [itinerary, setItinerary] = useState<ItineraryItem[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [activeTab, setActiveTab] = useState('itinerary');
  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [shoppingList, setShoppingList] = useState<{ id: string, item: string, completed: boolean }[]>([]);
  const [customRateFrom, setCustomRateFrom] = useState<string>('HKD');
  const [customRateTo, setCustomRateTo] = useState<string>('CAD');
  const [customRateAmount, setCustomRateAmount] = useState<string>('1');
  const [fromSearch, setFromSearch] = useState('');
  const [toSearch, setToSearch] = useState('');
  
  // Dialog Open States
  const [isTripDialogOpen, setIsTripDialogOpen] = useState(false);
  const [isExpenseDialogOpen, setIsExpenseDialogOpen] = useState(false);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [editingActivity, setEditingActivity] = useState<ItineraryItem | null>(null);
  const [deletingActivityId, setDeletingActivityId] = useState<string | null>(null);
  const [deletingActivityDay, setDeletingActivityDay] = useState<Date | null>(null);
  const [deletingTripId, setDeletingTripId] = useState<string | null>(null);
  const [deletingExpenseId, setDeletingExpenseId] = useState<string | null>(null);

  // Fetch Exchange Rates
  useEffect(() => {
    const fetchRates = async () => {
      try {
        const res = await fetch('https://open.er-api.com/v6/latest/USD');
        const data = await res.json();
        if (data.rates) {
          setExchangeRates(data.rates);
          setLastUpdated(new Date(data.time_last_update_unix * 1000).toLocaleString());
        }
      } catch (error) {
        console.error('Failed to fetch exchange rates', error);
      }
    };
    fetchRates();
  }, []);

  // Auth
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        await setDoc(doc(db, 'users', u.uid), { email: u.email?.toLowerCase() }, { merge: true });
      }
    });
    return () => unsubscribe();
  }, []);

  const login = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
      console.error('Login failed', error);
      toast.error('登入失敗');
    }
  };

  const logout = () => signOut(auth);

  const filteredFromCurrencies = useMemo(() => {
    return CURRENCIES.filter(c => c.toLowerCase().includes(fromSearch.toLowerCase()));
  }, [fromSearch]);

  const filteredToCurrencies = useMemo(() => {
    return CURRENCIES.filter(c => c.toLowerCase().includes(toSearch.toLowerCase()));
  }, [toSearch]);

  // Fetch Trips
  useEffect(() => {
    if (!user) {
      setTrips([]);
      return;
    }

    const tripsQ = query(
      collection(db, 'trips'),
      or(
        where('ownerId', '==', user.uid),
        where('collaboratorIds', 'array-contains', user.uid),
        where('collaboratorEmails', 'array-contains', user.email?.toLowerCase() ?? '')
      )
    );

    const unsub = onSnapshot(tripsQ, (snapshot) => {
      const allTrips = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          startDate: data.startDate instanceof Timestamp ? data.startDate.toDate() : new Date(data.startDate),
          endDate: data.endDate instanceof Timestamp ? data.endDate.toDate() : new Date(data.endDate),
        };
      }) as Trip[];
      
      allTrips.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
      setTrips(allTrips);
      
      setSelectedTrip(prev => {
        if (!prev) return allTrips.length > 0 ? allTrips[0] : null;
        const updated = allTrips.find(t => t.id === prev.id);
        return updated || (allTrips.length > 0 ? allTrips[0] : null);
      });
    }, (error) => {
      console.error('Trips query error:', error);
      toast.error(`讀取旅程失敗: ${error.message}`);
    });

    return () => unsub();
  }, [user]);

  // Fetch Trip Details (Itinerary, Expenses & Shopping List)
  useEffect(() => {
    if (!selectedTrip) {
      setItinerary([]);
      setExpenses([]);
      setShoppingList([]);
      return;
    }

    const itineraryUnsub = onSnapshot(
      query(collection(db, `trips/${selectedTrip.id}/itinerary`), orderBy('startTime', 'asc')),
      (snapshot) => {
        setItinerary(snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            startTime: data.startTime instanceof Timestamp ? data.startTime.toDate() : new Date(data.startTime),
            endTime: data.endTime ? (data.endTime instanceof Timestamp ? data.endTime.toDate() : new Date(data.endTime)) : undefined,
          };
        }) as ItineraryItem[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, `trips/${selectedTrip.id}/itinerary`)
    );

    const expensesUnsub = onSnapshot(
      query(collection(db, `trips/${selectedTrip.id}/expenses`), orderBy('date', 'desc')),
      (snapshot) => {
        setExpenses(snapshot.docs.map(doc => {
          const data = doc.data();
          return {
            id: doc.id,
            ...data,
            date: data.date instanceof Timestamp ? data.date.toDate() : new Date(data.date),
          };
        }) as Expense[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, `trips/${selectedTrip.id}/expenses`)
    );

    const shoppingUnsub = onSnapshot(
      query(collection(db, `trips/${selectedTrip.id}/shopping`), orderBy('createdAt', 'asc')),
      (snapshot) => {
        setShoppingList(snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
        })) as any[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, `trips/${selectedTrip.id}/shopping`)
    );

    return () => {
      itineraryUnsub();
      expensesUnsub();
      shoppingUnsub();
    };
  }, [selectedTrip]);

  // --- Actions ---

  const addTrip = async (data: Partial<Trip>) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'trips'), {
        name: data.name,
        startDate: Timestamp.fromDate(data.startDate!),
        endDate: Timestamp.fromDate(data.endDate!),
        budget: Number(data.budget) || 0,
        baseCurrency: data.baseCurrency || 'HKD',
        ownerId: user.uid,
        collaborators: [],
        collaboratorEmails: [],
        createdAt: Timestamp.now(),
      });
      toast.success('已新增旅程！');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'trips');
    }
  };

  const addItineraryItem = async (data: Partial<ItineraryItem>) => {
    if (!selectedTrip) return;
    try {
      await addDoc(collection(db, `trips/${selectedTrip.id}/itinerary`), {
        ...data,
        tripId: selectedTrip.id,
        startTime: Timestamp.fromDate(data.startTime!),
        endTime: data.endTime ? Timestamp.fromDate(data.endTime) : null,
      });
      toast.success('已新增活動！');
      
      // Scroll to the day
      const dayId = `day-${format(data.startTime!, 'yyyy-MM-dd')}`;
      setTimeout(() => {
        const element = document.getElementById(dayId);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 500);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `trips/${selectedTrip.id}/itinerary`);
    }
  };

  const updateItineraryItem = async (id: string, data: Partial<ItineraryItem>) => {
    if (!selectedTrip) return;
    try {
      await updateDoc(doc(db, `trips/${selectedTrip.id}/itinerary`, id), {
        ...data,
        startTime: data.startTime ? Timestamp.fromDate(data.startTime) : undefined,
        endTime: data.endTime ? Timestamp.fromDate(data.endTime) : null,
      });
      toast.success('已更新活動！');
      setEditingActivity(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `trips/${selectedTrip.id}/itinerary/${id}`);
    }
  };

  const addExpense = async (data: Partial<Expense>) => {
    if (!selectedTrip) return;
    try {
      await addDoc(collection(db, `trips/${selectedTrip.id}/expenses`), {
        ...data,
        tripId: selectedTrip.id,
        amount: Number(data.amount),
        date: Timestamp.fromDate(data.date!),
      });
      toast.success('已記錄開支！');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `trips/${selectedTrip.id}/expenses`);
    }
  };

  const deleteExpense = async (id: string) => {
    if (!selectedTrip || !confirm('確定要刪除此筆開支嗎？')) return;
    try {
      await deleteDoc(doc(db, `trips/${selectedTrip.id}/expenses`, id));
      toast.success('開支已刪除');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `trips/${selectedTrip.id}/expenses/${id}`);
    }
  };

  const addShoppingItem = async (item: string) => {
    if (!selectedTrip || !item.trim()) return;
    try {
      await addDoc(collection(db, `trips/${selectedTrip.id}/shopping`), {
        item: item.trim(),
        completed: false,
        createdAt: Timestamp.now(),
      });
      toast.success('已加入清單');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `trips/${selectedTrip.id}/shopping`);
    }
  };

  const toggleShoppingItem = async (id: string, completed: boolean) => {
    if (!selectedTrip) return;
    try {
      await updateDoc(doc(db, `trips/${selectedTrip.id}/shopping`, id), { completed });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `trips/${selectedTrip.id}/shopping/${id}`);
    }
  };

  const deleteShoppingItem = async (id: string) => {
    if (!selectedTrip) return;
    try {
      await deleteDoc(doc(db, `trips/${selectedTrip.id}/shopping`, id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `trips/${selectedTrip.id}/shopping/${id}`);
    }
  };

  const deleteTrip = async (id: string) => {
    if (!confirm('確定要刪除此旅程嗎？')) return;
    try {
      await deleteDoc(doc(db, 'trips', id));
      if (selectedTrip?.id === id) setSelectedTrip(null);
      toast.success('旅程已刪除');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `trips/${id}`);
    }
  };

  const addCollaborator = async () => {
    if (!selectedTrip || !shareEmail) return;
    const emailToAdd = shareEmail.trim().toLowerCase();
    if (emailToAdd === user?.email?.toLowerCase()) {
      toast.error('您已經是擁有者了');
      return;
    }
    try {
      const currentEmails = selectedTrip.collaboratorEmails || [];
      if (currentEmails.includes(emailToAdd)) {
        toast.error('該用戶已在協作者名單中');
        return;
      }
      const usersSnap = await getDocs(query(collection(db, 'users'), where('email', '==', emailToAdd)));
      const currentIds = selectedTrip.collaboratorIds || [];
      const updates: Record<string, unknown> = {
        collaboratorEmails: [...currentEmails, emailToAdd],
      };
      if (!usersSnap.empty) {
        const collaboratorUid = usersSnap.docs[0].id;
        updates.collaboratorIds = [...currentIds, collaboratorUid];
      }
      await updateDoc(doc(db, 'trips', selectedTrip.id), updates);
      toast.success('已新增協作者！');
      setShareEmail('');
      setIsShareDialogOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `trips/${selectedTrip.id}`);
    }
  };

  const removeCollaborator = async (email: string) => {
    if (!selectedTrip) return;
    try {
      const currentEmails = selectedTrip.collaboratorEmails || [];
      const updates: Record<string, unknown> = {
        collaboratorEmails: currentEmails.filter(e => e !== email),
      };
      const usersSnap = await getDocs(query(collection(db, 'users'), where('email', '==', email)));
      if (!usersSnap.empty) {
        const collaboratorUid = usersSnap.docs[0].id;
        const currentIds = selectedTrip.collaboratorIds || [];
        updates.collaboratorIds = currentIds.filter(id => id !== collaboratorUid);
      }
      await updateDoc(doc(db, 'trips', selectedTrip.id), updates);
      toast.success('已移除協作者');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `trips/${selectedTrip.id}`);
    }
  };

  // --- Calculations ---

  const convertToMain = (amount: number, from: string, to: string) => {
    if (from === to) return amount;
    if (!exchangeRates[from] || !exchangeRates[to]) return amount;
    // Convert to USD first then to target
    const inUSD = amount / exchangeRates[from];
    return inUSD * exchangeRates[to];
  };

  const totalSpent = useMemo(() => {
    if (!selectedTrip) return 0;
    return expenses.reduce((sum, e) => {
      const converted = convertToMain(e.amount, e.currency || 'USD', selectedTrip.baseCurrency);
      return sum + converted;
    }, 0);
  }, [expenses, selectedTrip, exchangeRates]);

  const budgetRemaining = selectedTrip ? selectedTrip.budget - totalSpent : 0;
  const budgetPercentage = selectedTrip ? Math.min((totalSpent / selectedTrip.budget) * 100, 100) : 0;

  const expenseByCategory = useMemo(() => {
    if (!selectedTrip) return [];
    const data: Record<string, number> = {};
    expenses.forEach(e => {
      const converted = convertToMain(e.amount, e.currency || 'USD', selectedTrip.baseCurrency);
      data[e.category] = (data[e.category] || 0) + converted;
    });
    return Object.entries(data).map(([name, value]) => ({ name, value }));
  }, [expenses, selectedTrip, exchangeRates]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-neutral-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-50 p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-6 max-w-md"
        >
          <div className="bg-primary/10 p-6 rounded-full inline-block">
            <CalendarIcon className="w-12 h-12 text-primary" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-neutral-900">旅程助手 (TripMate)</h1>
          <p className="text-neutral-600 text-lg">
            一站式規劃行程與追蹤開支，您的最佳旅遊夥伴。
          </p>
          <Button size="lg" onClick={login} className="w-full text-lg h-12">
            使用 Google 帳號登入
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-50 pb-20">
      <Toaster position="top-center" />
      
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-primary text-white p-1.5 rounded-lg">
              <CalendarIcon className="w-5 h-5" />
            </div>
            <span className="font-bold text-xl tracking-tight hidden sm:inline-block">旅程助手 (TripMate)</span>
          </div>

          <div className="flex items-center gap-4">
            <Dialog open={isTripDialogOpen} onOpenChange={setIsTripDialogOpen}>
              <DialogTrigger render={
                <Button variant="outline" size="sm" className="gap-2">
                  <Plus className="w-4 h-4" /> 新增旅程
                </Button>
              } />
              <DialogContent>
                <AddTripForm onSubmit={addTrip} />
              </DialogContent>
            </Dialog>

            <Popover>
              <PopoverTrigger render={
                <Button variant="ghost" size="icon" className="rounded-full overflow-hidden border">
                  <img src={user.photoURL || ''} alt={user.displayName || ''} className="w-full h-full object-cover" />
                </Button>
              } />
              <PopoverContent className="w-56" align="end">
                <div className="flex flex-col gap-2">
                  <p className="font-medium text-sm px-2">{user.displayName}</p>
                  <p className="text-xs text-neutral-500 px-2 truncate">{user.email}</p>
                  <hr className="my-1" />
                  <Button variant="ghost" size="sm" onClick={logout} className="justify-start text-red-500 hover:text-red-600 hover:bg-red-50">
                    <LogOut className="w-4 h-4 mr-2" /> 登出
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Sidebar: Trip List */}
        <aside className="lg:col-span-3 space-y-6">
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-neutral-500 uppercase tracking-wider">未來旅程</h2>
            <div className="space-y-2">
              {trips.filter(t => !isBefore(t.endDate, startOfDay(new Date()))).map((trip) => (
                <div
                  key={trip.id}
                  onClick={() => setSelectedTrip(trip)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedTrip(trip); }}
                  className={cn(
                    "w-full text-left p-4 rounded-xl border transition-all duration-200 group relative cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    selectedTrip?.id === trip.id 
                      ? "bg-white border-primary shadow-sm ring-1 ring-primary" 
                      : "bg-white/50 border-neutral-200 hover:border-neutral-300 hover:bg-white"
                  )}
                >
                  <div className="flex justify-between items-start mb-1">
                    <h3 className="font-semibold text-neutral-900 truncate pr-6">{trip.name}</h3>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setDeletingTripId(trip.id); }}
                      className="p-1 text-red-400 hover:text-red-600 absolute top-3 right-3"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-neutral-500">
                    {format(trip.startDate, 'yyyy年M月d日')} - {format(trip.endDate, 'yyyy年M月d日')}
                  </p>
                </div>
              ))}
              {trips.filter(t => !isBefore(t.endDate, startOfDay(new Date()))).length === 0 && (
                <div className="text-center py-8 border-2 border-dashed rounded-xl border-neutral-200">
                  <p className="text-xs text-neutral-400">暫無未來旅程</p>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-neutral-500 uppercase tracking-wider">已完結旅程</h2>
            <div className="space-y-2">
              {trips.filter(t => isBefore(t.endDate, startOfDay(new Date()))).map((trip) => (
                <div
                  key={trip.id}
                  onClick={() => setSelectedTrip(trip)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedTrip(trip); }}
                  className={cn(
                    "w-full text-left p-4 rounded-xl border transition-all duration-200 group relative cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary opacity-75 grayscale-[0.5] hover:opacity-100 hover:grayscale-0",
                    selectedTrip?.id === trip.id 
                      ? "bg-white border-primary shadow-sm ring-1 ring-primary" 
                      : "bg-white/50 border-neutral-200 hover:border-neutral-300 hover:bg-white"
                  )}
                >
                  <div className="flex justify-between items-start mb-1">
                    <h3 className="font-semibold text-neutral-900 truncate pr-6">{trip.name}</h3>
                    <button 
                      onClick={(e) => { e.stopPropagation(); setDeletingTripId(trip.id); }}
                      className="p-1 text-red-400 hover:text-red-600 absolute top-3 right-3"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-xs text-neutral-500">
                    {format(trip.startDate, 'yyyy年M月d日')} - {format(trip.endDate, 'yyyy年M月d日')}
                  </p>
                </div>
              ))}
              {trips.filter(t => isBefore(t.endDate, startOfDay(new Date()))).length === 0 && (
                <div className="text-center py-8 border-2 border-dashed rounded-xl border-neutral-200">
                  <p className="text-xs text-neutral-400">暫無已完結旅程</p>
                </div>
              )}
            </div>
          </div>
        </aside>

        <Dialog open={!!deletingTripId} onOpenChange={(open) => !open && setDeletingTripId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>確認刪除旅程</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <p className="text-neutral-600">您確定要刪除此旅程嗎？這將會刪除所有相關的行程、開支和清單資料。此操作無法復原。</p>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setDeletingTripId(null)}>取消</Button>
              <Button 
                variant="destructive" 
                onClick={() => {
                  if (deletingTripId) {
                    deleteTrip(deletingTripId);
                    setDeletingTripId(null);
                  }
                }}
              >
                確認刪除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Main Content */}
        <div className="lg:col-span-9 space-y-6">
          {selectedTrip ? (
            <motion.div
              key={selectedTrip.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              {/* Trip Overview Card */}
              <Card className="overflow-hidden border-none shadow-md bg-gradient-to-br from-primary/5 to-transparent">
                <CardHeader className="pb-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div>
                        <CardTitle className="text-3xl font-bold flex items-center gap-3">
                          {selectedTrip.name}
                          {selectedTrip.ownerId !== user.uid && (
                            <Badge variant="secondary" className="text-[10px] uppercase tracking-wider">協作中</Badge>
                          )}
                        </CardTitle>
                        <CardDescription className="flex items-center gap-2 mt-1">
                          <CalendarIcon className="w-4 h-4" />
                          {format(selectedTrip.startDate, 'yyyy年M月d日')} - {format(selectedTrip.endDate, 'yyyy年M月d日')}
                        </CardDescription>
                      </div>
                      
                      {selectedTrip.ownerId === user.uid && (
                        <Dialog open={isShareDialogOpen} onOpenChange={setIsShareDialogOpen}>
                          <DialogTrigger render={
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-neutral-400 hover:text-primary hover:bg-primary/5">
                              <Share2 className="w-4 h-4" />
                            </Button>
                          } />
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>分享旅程</DialogTitle>
                              <CardDescription>邀請其他人一齊編輯此旅程</CardDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
                                <p className="font-bold mb-1">如何分享：</p>
                                <ol className="list-decimal ml-4 space-y-1">
                                  <li>在此輸入對方的 Google Email 並點擊「邀請」。</li>
                                  <li>系統<strong>不會</strong>自動發送 Email 通知。</li>
                                  <li>請手動將 <strong>App 網址</strong> 傳給對方，他們登入後就會看到旅程。</li>
                                </ol>
                              </div>

                              {window.location.hostname.includes('ais-dev') && (
                                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
                                  <p className="font-bold mb-1">⚠️ 注意：網址錯誤</p>
                                  <p>您目前正在使用「開發版網址」(ais-dev)，其他人無法進入。請使用 AI Studio 右上角的「Share」功能發佈 App，並傳送正式的網址給朋友。</p>
                                </div>
                              )}

                              <div className="space-y-2">
                                <Label>協作者 Email</Label>
                                <div className="flex gap-2">
                                  <Input 
                                    placeholder="example@gmail.com" 
                                    value={shareEmail}
                                    onChange={(e) => setShareEmail(e.target.value)}
                                  />
                                  <Button onClick={addCollaborator}>邀請</Button>
                                </div>
                              </div>
                              
                              <div className="pt-4 border-t">
                                <Button 
                                  variant="outline" 
                                  className="w-full gap-2"
                                  onClick={() => {
                                    const text = `我邀請你一齊編輯旅程「${selectedTrip.name}」！\n請打開網址並登入：${window.location.origin}`;
                                    navigator.clipboard.writeText(text);
                                    toast.success('已複製邀請訊息，請手動傳給對方');
                                  }}
                                >
                                  <Share2 className="w-4 h-4" />
                                  複製邀請訊息及連結
                                </Button>
                              </div>
                              <div className="space-y-2">
                                <Label className="text-xs text-neutral-500 uppercase">現有協作者</Label>
                                <div className="space-y-2">
                                  {selectedTrip.collaboratorEmails?.map(email => (
                                    <div key={email} className="flex items-center justify-between p-2 rounded-lg bg-neutral-50 border">
                                      <span className="text-sm">{email}</span>
                                      <Button 
                                        variant="ghost" 
                                        size="sm" 
                                        onClick={() => removeCollaborator(email)}
                                        className="h-7 text-red-500 hover:text-red-600 hover:bg-red-50"
                                      >
                                        移除
                                      </Button>
                                    </div>
                                  ))}
                                  {(!selectedTrip.collaboratorEmails || selectedTrip.collaboratorEmails.length === 0) && (
                                    <p className="text-xs text-neutral-400 text-center py-4">暫無協作者</p>
                                  )}
                                </div>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-neutral-500 font-medium">預算狀態 ({selectedTrip.baseCurrency})</p>
                      <p className="text-2xl font-bold">
                        {totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-sm font-normal text-neutral-400">/ {selectedTrip.budget.toLocaleString()}</span>
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="h-3 w-full bg-neutral-200 rounded-full overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${budgetPercentage}%` }}
                        className={cn(
                          "h-full transition-all duration-500",
                          budgetPercentage > 90 ? "bg-red-500" : budgetPercentage > 70 ? "bg-amber-500" : "bg-primary"
                        )}
                      />
                    </div>
                    <div className="flex justify-between text-xs font-medium">
                      <span className={cn(budgetRemaining < 0 ? "text-red-500" : "text-neutral-500")}>
                        {budgetRemaining < 0 
                          ? `超出預算 ${selectedTrip.baseCurrency} ${Math.abs(budgetRemaining).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
                          : `剩餘 ${selectedTrip.baseCurrency} ${budgetRemaining.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </span>
                      <span className="text-neutral-500">已使用 {Math.round(budgetPercentage)}%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Tabs */}
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-5 h-12 p-1 bg-neutral-100 rounded-xl">
                  <TabsTrigger value="itinerary" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm text-xs sm:text-sm">
                    行程
                  </TabsTrigger>
                  <TabsTrigger value="expenses" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm text-xs sm:text-sm">
                    開支
                  </TabsTrigger>
                  <TabsTrigger value="shopping" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm text-xs sm:text-sm">
                    清單
                  </TabsTrigger>
                  <TabsTrigger value="analytics" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm text-xs sm:text-sm">
                    分析
                  </TabsTrigger>
                  <TabsTrigger value="rates" className="rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm text-xs sm:text-sm">
                    匯率
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="itinerary" className="mt-6 space-y-6">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xl font-bold">每日行程</h3>
                  </div>

                  <ItineraryTimeline 
                    items={itinerary} 
                    trip={selectedTrip} 
                    onDelete={(id, day) => {
                      setDeletingActivityId(id);
                      setDeletingActivityDay(day || null);
                    }}
                    onEdit={(item) => setEditingActivity(item)}
                    onAdd={addItineraryItem}
                  />

                  <Dialog open={!!deletingActivityId} onOpenChange={(open) => !open && setDeletingActivityId(null)}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>確認刪除</DialogTitle>
                      </DialogHeader>
                      <div className="py-4">
                        <p className="text-neutral-600">您確定要刪除此活動嗎？此操作無法復原。</p>
                      </div>
                      <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => {
                          setDeletingActivityId(null);
                          setDeletingActivityDay(null);
                        }}>取消</Button>
                        <Button 
                          variant="destructive" 
                          onClick={async () => {
                            if (deletingActivityId && selectedTrip) {
                              try {
                                const itemRef = doc(db, `trips/${selectedTrip.id}/itinerary`, deletingActivityId);
                                const item = itinerary.find(i => i.id === deletingActivityId);
                                
                                if (item && deletingActivityDay) {
                                  const itemStart = startOfDay(item.startTime);
                                  const itemEnd = item.endTime ? startOfDay(item.endTime) : itemStart;
                                  const isMultiDay = itemEnd > itemStart;

                                  if (isMultiDay) {
                                    const targetDay = startOfDay(deletingActivityDay);
                                    
                                    if (isSameDay(itemStart, targetDay)) {
                                      // Deleting first day
                                      await updateDoc(itemRef, {
                                        startTime: Timestamp.fromDate(addDays(item.startTime, 1))
                                      });
                                    } else if (isSameDay(itemEnd, targetDay)) {
                                      // Deleting last day
                                      await updateDoc(itemRef, {
                                        endTime: Timestamp.fromDate(addDays(item.endTime!, -1))
                                      });
                                    } else {
                                      // Deleting middle day - split into two
                                      const originalEndTime = item.endTime!;
                                      // Update current to end at previous day
                                      await updateDoc(itemRef, {
                                        endTime: Timestamp.fromDate(addDays(targetDay, -1))
                                      });
                                      // Create new for the rest
                                      await addDoc(collection(db, `trips/${selectedTrip.id}/itinerary`), {
                                        ...item,
                                        id: undefined, // Let Firestore generate ID
                                        startTime: Timestamp.fromDate(addDays(targetDay, 1)),
                                        endTime: Timestamp.fromDate(originalEndTime)
                                      });
                                    }
                                    toast.success('已移除當天行程');
                                  } else {
                                    await deleteDoc(itemRef);
                                    toast.success('活動已刪除');
                                  }
                                } else {
                                  await deleteDoc(itemRef);
                                  toast.success('活動已刪除');
                                }
                              } catch (error) {
                                handleFirestoreError(error, OperationType.DELETE, `trips/${selectedTrip.id}/itinerary/${deletingActivityId}`);
                              }
                              setDeletingActivityId(null);
                              setDeletingActivityDay(null);
                            }
                          }}
                        >
                          確認刪除
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  <Dialog open={!!editingActivity} onOpenChange={(open) => !open && setEditingActivity(null)}>
                    <DialogContent>
                      {editingActivity && (
                        <AddItineraryForm 
                          trip={selectedTrip} 
                          initialData={editingActivity} 
                          onSubmit={(data) => updateItineraryItem(editingActivity.id, data)} 
                        />
                      )}
                    </DialogContent>
                  </Dialog>
                </TabsContent>

                <TabsContent value="expenses" className="mt-6 space-y-6">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xl font-bold">開支清單</h3>
                    <Dialog open={isExpenseDialogOpen} onOpenChange={setIsExpenseDialogOpen}>
                      <DialogTrigger render={
                        <Button size="sm" className="gap-2">
                          <Plus className="w-4 h-4" /> 記錄開支
                        </Button>
                      } />
                      <DialogContent>
                        <AddExpenseForm onSubmit={addExpense} baseCurrency={selectedTrip.baseCurrency} />
                      </DialogContent>
                    </Dialog>
                  </div>

                  <ExpenseList 
                    expenses={expenses} 
                    baseCurrency={selectedTrip.baseCurrency}
                    convertToMain={convertToMain}
                    onDelete={(id) => setDeletingExpenseId(id)} 
                  />

                  <Dialog open={!!deletingExpenseId} onOpenChange={(open) => !open && setDeletingExpenseId(null)}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>確認刪除開支</DialogTitle>
                      </DialogHeader>
                      <div className="py-4">
                        <p className="text-neutral-600">您確定要刪除此筆開支記錄嗎？此操作無法復原。</p>
                      </div>
                      <DialogFooter className="gap-2 sm:gap-0">
                        <Button variant="outline" onClick={() => setDeletingExpenseId(null)}>取消</Button>
                        <Button 
                          variant="destructive" 
                          onClick={() => {
                            if (deletingExpenseId) {
                              deleteExpense(deletingExpenseId);
                              setDeletingExpenseId(null);
                            }
                          }}
                        >
                          確認刪除
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </TabsContent>

                <TabsContent value="shopping" className="mt-6 space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">購物清單</CardTitle>
                      <CardDescription>記錄想買的伴手禮或物品</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="flex gap-2">
                        <Input 
                          id="new-shopping-item"
                          placeholder="新增物品..." 
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              addShoppingItem(e.currentTarget.value);
                              e.currentTarget.value = '';
                            }
                          }}
                        />
                        <Button onClick={() => {
                          const input = document.getElementById('new-shopping-item') as HTMLInputElement;
                          addShoppingItem(input.value);
                          input.value = '';
                        }}>新增</Button>
                      </div>
                      <div className="space-y-2">
                        {shoppingList.map(item => (
                          <div key={item.id} className="flex items-center justify-between p-3 bg-neutral-50 rounded-lg border border-neutral-100">
                            <div className="flex items-center gap-3">
                              <input 
                                type="checkbox" 
                                checked={item.completed} 
                                onChange={(e) => toggleShoppingItem(item.id, e.target.checked)}
                                className="w-5 h-5 rounded border-neutral-300 text-primary focus:ring-primary"
                              />
                              <span className={cn("text-sm font-medium", item.completed && "line-through text-neutral-400")}>
                                {item.item}
                              </span>
                            </div>
                            <button onClick={() => deleteShoppingItem(item.id)} className="text-red-400 hover:text-red-600 p-1">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                        {shoppingList.length === 0 && (
                          <p className="text-center py-8 text-sm text-neutral-400 italic">清單還是空的，快去購物吧！</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="analytics" className="mt-6 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">開支類別分佈</CardTitle>
                      </CardHeader>
                      <CardContent className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={expenseByCategory}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={80}
                              paddingAngle={5}
                              dataKey="value"
                              label={({ name, percent }) => `${CATEGORY_LABELS[name as keyof typeof CATEGORY_LABELS]} ${(percent * 100).toFixed(0)}%`}
                            >
                              {expenseByCategory.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={CATEGORY_COLORS[entry.name as keyof typeof CATEGORY_COLORS] || '#8884d8'} />
                              ))}
                            </Pie>
                            <RechartsTooltip formatter={(value: number) => `${selectedTrip.baseCurrency} ${value.toFixed(2)}`} />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="flex flex-wrap justify-center gap-4 mt-4">
                          {expenseByCategory.map((entry) => (
                            <div key={entry.name} className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[entry.name as keyof typeof CATEGORY_COLORS] }} />
                              <span className="text-xs font-medium capitalize">{CATEGORY_LABELS[entry.name as keyof typeof CATEGORY_LABELS]}</span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">每日開支趨勢</CardTitle>
                      </CardHeader>
                      <CardContent className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={expenses.reduce((acc: any[], curr) => {
                            const date = format(curr.date, 'M月d日');
                            const converted = convertToMain(curr.amount, curr.currency || 'USD', selectedTrip.baseCurrency);
                            const existing = acc.find(a => a.date === date);
                            if (existing) existing.amount += converted;
                            else acc.push({ date, amount: converted });
                            return acc;
                          }, []).reverse()}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="date" fontSize={10} />
                            <YAxis fontSize={10} />
                            <RechartsTooltip formatter={(value: number) => `${selectedTrip.baseCurrency} ${value.toFixed(2)}`} />
                            <Bar dataKey="amount" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </CardContent>
                    </Card>
                  </div>
                </TabsContent>

                <TabsContent value="rates" className="mt-6 space-y-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">自定義匯率轉換</CardTitle>
                      <CardDescription>自由選擇兩種貨幣進行換算</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                      <div className="grid grid-cols-1 sm:grid-cols-3 items-end gap-4">
                        <div className="w-full">
                          <Label className="text-xs mb-1.5 block">金額 (Amount)</Label>
                          <Input 
                            type="number" 
                            value={customRateAmount} 
                            onChange={(e) => setCustomRateAmount(e.target.value)}
                            placeholder="輸入金額"
                            className="h-10"
                          />
                        </div>

                        <div className="w-full">
                          <Label className="text-xs mb-1.5 block">從 (From)</Label>
                          <Select value={customRateFrom} onValueChange={setCustomRateFrom}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="選擇貨幣" />
                            </SelectTrigger>
                            <SelectContent onPointerDownOutside={(e) => e.preventDefault()}>
                              <div className="p-2 sticky top-0 bg-white z-10 border-b">
                                <Input 
                                  placeholder="搜尋貨幣 (如: H)" 
                                  className="h-9 text-sm"
                                  value={fromSearch}
                                  onChange={(e) => setFromSearch(e.target.value)}
                                  onKeyDown={(e) => e.stopPropagation()}
                                />
                              </div>
                              <ScrollArea className="h-[200px]">
                                {filteredFromCurrencies.length > 0 ? (
                                  filteredFromCurrencies.map(c => (
                                    <SelectItem key={c} value={c}>{c}</SelectItem>
                                  ))
                                ) : (
                                  <div className="p-4 text-center text-xs text-neutral-400">找不到貨幣</div>
                                )}
                              </ScrollArea>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="w-full">
                          <Label className="text-xs mb-1.5 block">到 (To)</Label>
                          <Select value={customRateTo} onValueChange={setCustomRateTo}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="選擇貨幣" />
                            </SelectTrigger>
                            <SelectContent onPointerDownOutside={(e) => e.preventDefault()}>
                              <div className="p-2 sticky top-0 bg-white z-10 border-b">
                                <Input 
                                  placeholder="搜尋貨幣 (如: C)" 
                                  className="h-9 text-sm"
                                  value={toSearch}
                                  onChange={(e) => setToSearch(e.target.value)}
                                  onKeyDown={(e) => e.stopPropagation()}
                                />
                              </div>
                              <ScrollArea className="h-[200px]">
                                {filteredToCurrencies.length > 0 ? (
                                  filteredToCurrencies.map(c => (
                                    <SelectItem key={c} value={c}>{c}</SelectItem>
                                  ))
                                ) : (
                                  <div className="p-4 text-center text-xs text-neutral-400">找不到貨幣</div>
                                )}
                              </ScrollArea>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      <div className="p-6 bg-primary/5 rounded-2xl border border-primary/10 flex flex-col items-center justify-center text-center">
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className="text-sm font-bold text-primary/60">{Number(customRateAmount).toLocaleString()} {customRateFrom} =</span>
                          <span className="text-3xl font-black text-primary">
                            {convertToMain(Number(customRateAmount) || 0, customRateFrom, customRateTo).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                          </span>
                        </div>
                        <span className="text-sm font-bold text-primary/60">{customRateTo}</span>
                        
                        <div className="mt-4 pt-4 border-t border-primary/10 w-full flex justify-between text-xs font-bold text-primary/60">
                          <span>匯率參考:</span>
                          <span>1 {customRateFrom} = {convertToMain(1, customRateFrom, customRateTo).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} {customRateTo}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <div className="flex justify-between items-center">
                        <div>
                          <CardTitle className="text-lg">常用匯率參考</CardTitle>
                          <CardDescription>以 {selectedTrip.baseCurrency} 為基準</CardDescription>
                        </div>
                        <Badge variant="outline" className="text-[10px]">
                          更新於: {lastUpdated}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                        {CURRENCIES.filter(c => c !== selectedTrip.baseCurrency).map(currency => {
                          const rate = convertToMain(1, currency, selectedTrip.baseCurrency);
                          return (
                            <div key={currency} className="p-4 bg-neutral-50 rounded-xl border border-neutral-100 flex flex-col items-center justify-center text-center">
                              <span className="text-xs font-bold text-neutral-400 mb-1">1 {currency} =</span>
                              <span className="text-lg font-bold text-neutral-900">
                                {rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                              </span>
                              <span className="text-[10px] font-medium text-neutral-500 mt-1">{selectedTrip.baseCurrency}</span>
                            </div>
                          );
                        })}
                      </div>
                      <p className="mt-6 text-[10px] text-neutral-400 text-center italic">
                        匯率數據僅供參考，實際交易請以銀行或找換店為準。
                      </p>
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </motion.div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
              <div className="bg-neutral-100 p-6 rounded-full">
                <MapPin className="w-12 h-12 text-neutral-300" />
              </div>
              <h3 className="text-xl font-semibold text-neutral-900">請從側欄選擇或新增旅程</h3>
              <p className="text-neutral-500 max-w-xs">
                選擇一個現有的旅程開始規劃，或點擊「新增旅程」開始您的冒險。
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// --- Sub-components ---

function AddTripForm({ onSubmit }: { onSubmit: (data: Partial<Trip>) => void }) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState<Date>();
  const [endDate, setEndDate] = useState<Date>();
  const [budget, setBudget] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('HKD');

  // When start date changes, if end date is before it, reset end date
  useEffect(() => {
    if (startDate && endDate && endDate < startDate) {
      setEndDate(undefined);
    }
  }, [startDate, endDate]);

  return (
    <div className="space-y-4 py-4">
      <DialogHeader>
        <DialogTitle>新增旅程</DialogTitle>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="trip-name">旅程名稱</Label>
        <Input id="trip-name" placeholder="例如：東京之行" value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>開始日期</Label>
          <Popover>
            <PopoverTrigger render={
              <Button variant="outline" className="w-full justify-start text-left font-normal">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {startDate ? format(startDate, "yyyy年M月d日", { locale: zhTW }) : <span>選擇日期</span>}
              </Button>
            } />
            <PopoverContent className="w-auto p-0">
              <Calendar 
                mode="single" 
                selected={startDate} 
                onSelect={setStartDate} 
                initialFocus 
              />
            </PopoverContent>
          </Popover>
        </div>
        <div className="space-y-2">
          <Label>結束日期</Label>
          <Popover>
            <PopoverTrigger render={
              <Button variant="outline" className="w-full justify-start text-left font-normal">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {endDate ? format(endDate, "yyyy年M月d日", { locale: zhTW }) : <span>選擇日期</span>}
              </Button>
            } />
            <PopoverContent className="w-auto p-0">
              <Calendar 
                mode="single" 
                selected={endDate} 
                onSelect={setEndDate} 
                initialFocus
                disabled={(date) => startDate ? date < startOfDay(startDate) : false}
                defaultMonth={startDate}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="budget">預算金額</Label>
          <Input id="budget" type="number" placeholder="0.00" value={budget} onChange={e => setBudget(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>結算幣種</Label>
          <Select value={baseCurrency} onValueChange={setBaseCurrency}>
            <SelectTrigger>
              <SelectValue placeholder="選擇幣種" />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <DialogFooter>
        <DialogClose render={
          <Button 
            className="w-full" 
            disabled={!name || !startDate || !endDate}
            onClick={() => onSubmit({ name, startDate, endDate, budget: Number(budget), baseCurrency })}
          >
            建立旅程
          </Button>
        } />
      </DialogFooter>
    </div>
  );
}

function AddItineraryForm({ trip, onSubmit, initialData, defaultDate }: { trip: Trip, onSubmit: (data: Partial<ItineraryItem>) => void, initialData?: ItineraryItem, defaultDate?: Date }) {
  const [title, setTitle] = useState(initialData?.title || '');
  const [startTime, setStartTime] = useState<string>(
    initialData?.startTime ? format(new Date(initialData.startTime), "yyyy-MM-dd'T'HH:mm") : 
    defaultDate ? format(new Date(defaultDate), "yyyy-MM-dd'T'09:00") : ''
  );
  const [endTime, setEndTime] = useState<string>(
    initialData?.endTime ? format(new Date(initialData.endTime), "yyyy-MM-dd'T'HH:mm") : ''
  );

  // Auto-set end time to 1 hour after start time when start time changes
  const handleStartTimeChange = (newStartTime: string) => {
    setStartTime(newStartTime);
    if (newStartTime && !initialData) {
      const start = new Date(newStartTime);
      const end = addHours(start, 1);
      setEndTime(format(end, "yyyy-MM-dd'T'HH:mm"));
    }
  };

  const [location, setLocation] = useState(initialData?.location || '');
  const [locationSuggestions, setLocationSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [type, setType] = useState<ItineraryItem['type']>(initialData?.type || 'activity');
  const [notes, setNotes] = useState(initialData?.notes || '');

  // Fetch location suggestions from Photon (OpenStreetMap based)
  useEffect(() => {
    const fetchSuggestions = async () => {
      if (location.length < 2) {
        setLocationSuggestions([]);
        return;
      }
      try {
        const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(location)}&limit=5`);
        const data = await res.json();
        setLocationSuggestions(data.features || []);
      } catch (error) {
        console.error('Failed to fetch location suggestions', error);
      }
    };

    const timer = setTimeout(fetchSuggestions, 300);
    return () => clearTimeout(timer);
  }, [location]);

  // Set default start time to trip start date (formatted for datetime-local) if not editing and no defaultDate
  useEffect(() => {
    if (trip?.startDate && !initialData && !defaultDate && !startTime) {
      const date = new Date(trip.startDate);
      const formatted = format(date, "yyyy-MM-dd'T'09:00");
      setStartTime(formatted);
      const end = addHours(date, 10); // Default to 10:00
      setEndTime(format(end, "yyyy-MM-dd'T'HH:mm"));
    }
  }, [trip, initialData, defaultDate]);

  const isInvalid = !title || !startTime || (endTime !== '' && new Date(endTime) < new Date(startTime));

  const handleSubmit = () => {
    if (isInvalid) return;
    
    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : undefined;

    onSubmit({ 
      title, 
      startTime: start, 
      endTime: end,
      location, 
      type, 
      notes 
    });
  };

  return (
    <div className="space-y-4 py-4">
      <DialogHeader>
        <DialogTitle>{initialData ? '編輯活動' : '新增活動'}</DialogTitle>
      </DialogHeader>
      <div className="space-y-2">
        <Label>活動名稱</Label>
        <Input placeholder="例如：參觀淺草寺" value={title} onChange={e => setTitle(e.target.value)} />
      </div>
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>類別</Label>
          <Select value={type} onValueChange={(v: any) => setType(v)}>
            <SelectTrigger>
              <SelectValue placeholder="選擇類別">
                {type ? TYPE_LABELS[type as keyof typeof TYPE_LABELS] : undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="flight">航班</SelectItem>
              <SelectItem value="hotel">住宿</SelectItem>
              <SelectItem value="activity">活動</SelectItem>
              <SelectItem value="transport">交通</SelectItem>
              <SelectItem value="food">餐飲</SelectItem>
            </SelectContent>
          </Select>
        </div>
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="space-y-2 flex-1 sm:max-w-[200px]">
                <Label>開始時間</Label>
                <Input 
                  type="datetime-local" 
                  className="w-full"
                  value={startTime}
                  min={format(startOfDay(trip.startDate), "yyyy-MM-dd'T'00:00")}
                  max={format(endOfDay(trip.endDate), "yyyy-MM-dd'T'23:59")}
                  onChange={e => handleStartTimeChange(e.target.value)} 
                />
              </div>
              <div className="space-y-2 flex-1 sm:max-w-[200px]">
                <Label>結束時間 (可選)</Label>
                <Input 
                  type="datetime-local" 
                  className="w-full"
                  value={endTime}
                  min={startTime || format(startOfDay(trip.startDate), "yyyy-MM-dd'T'00:00")}
                  max={format(endOfDay(trip.endDate), "yyyy-MM-dd'T'23:59")}
                  onChange={e => setEndTime(e.target.value)} 
                />
              </div>
            </div>
      </div>
      <div className="space-y-2 relative">
        <Label>地點</Label>
        <div className="relative">
          <Input 
            placeholder="地址或地點名稱" 
            value={location} 
            onChange={e => {
              setLocation(e.target.value);
              setShowSuggestions(true);
            }} 
            onFocus={() => setShowSuggestions(true)}
          />
          {showSuggestions && locationSuggestions.length > 0 && (
            <div className="absolute z-50 w-full mt-1 bg-white border rounded-md shadow-lg max-h-60 overflow-auto">
              {locationSuggestions.map((feature, i) => {
                const p = feature.properties;
                const label = [p.name, p.city, p.country].filter(Boolean).join(', ');
                return (
                  <div
                    key={i}
                    className="px-3 py-2 hover:bg-neutral-100 cursor-pointer text-sm border-b last:border-0"
                    onClick={() => {
                      setLocation(label);
                      setShowSuggestions(false);
                    }}
                  >
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-neutral-500">{[p.city, p.state, p.country].filter(Boolean).join(', ')}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <div className="space-y-2">
        <Label>備註</Label>
        <Input placeholder="預約編號、提醒事項..." value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
      <DialogFooter>
        <DialogClose render={
          <Button 
            className="w-full" 
            disabled={isInvalid}
            onClick={handleSubmit}
          >
            {initialData ? '儲存修改' : '加入行程'}
          </Button>
        } />
      </DialogFooter>
    </div>
  );
}

function AddExpenseForm({ onSubmit, baseCurrency }: { onSubmit: (data: Partial<Expense>) => void, baseCurrency: string }) {
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState(baseCurrency);
  const [category, setCategory] = useState<Expense['category']>('other');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState<Date>(new Date());

  return (
    <div className="space-y-4 py-4">
      <DialogHeader>
        <DialogTitle>記錄開支</DialogTitle>
      </DialogHeader>
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2 space-y-2">
          <Label>金額</Label>
          <Input type="number" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>幣種</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label>類別</Label>
        <Select value={category} onValueChange={(v: any) => setCategory(v)}>
          <SelectTrigger>
            <SelectValue placeholder="選擇類別">
              {category ? CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="transport">交通</SelectItem>
            <SelectItem value="food">餐飲</SelectItem>
            <SelectItem value="accommodation">住宿</SelectItem>
            <SelectItem value="shopping">購物</SelectItem>
            <SelectItem value="other">其他</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>描述</Label>
        <Input placeholder="這筆錢花在哪裡？" value={description} onChange={e => setDescription(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>日期</Label>
        <Popover>
          <PopoverTrigger render={
            <Button variant="outline" className="w-full justify-start text-left font-normal">
              <CalendarIcon className="mr-2 h-4 w-4" />
              {date ? format(date, "yyyy年M月d日", { locale: zhTW }) : <span>選擇日期</span>}
            </Button>
          } />
          <PopoverContent className="w-auto p-0">
            <Calendar mode="single" selected={date} onSelect={(d) => d && setDate(d)} initialFocus />
          </PopoverContent>
        </Popover>
      </div>
      <DialogFooter>
        <DialogClose render={
          <Button 
            className="w-full" 
            disabled={!amount || !description}
            onClick={() => onSubmit({ amount: Number(amount), currency, category, description, date })}
          >
            儲存開支
          </Button>
        } />
      </DialogFooter>
    </div>
  );
}

function ItineraryTimeline({ items, trip, onDelete, onEdit, onAdd }: { items: ItineraryItem[], trip: Trip, onDelete: (id: string, day?: Date) => void, onEdit: (item: ItineraryItem) => void, onAdd: (data: Partial<ItineraryItem>) => Promise<void> | void }) {
  const days = useMemo(() => {
    const tripDays = [];
    let current = startOfDay(trip.startDate);
    const end = startOfDay(trip.endDate);
    
    while (current <= end) {
      tripDays.push(new Date(current));
      current = addDays(current, 1);
    }
    return tripDays;
  }, [trip]);

  return (
    <div className="space-y-8">
      {days.map((day, idx) => {
        const dayItems = items.filter(item => {
          const itemStart = startOfDay(item.startTime);
          const itemEnd = item.endTime ? startOfDay(item.endTime) : itemStart;
          const currentDay = startOfDay(day);
          return currentDay >= itemStart && currentDay <= itemEnd;
        });
        const dayId = `day-${format(day, 'yyyy-MM-dd')}`;
        
        return (
          <div key={day.toISOString()} id={dayId} className="relative pl-8 border-l-2 border-neutral-200 last:border-l-0 pb-8 scroll-mt-20">
            <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-primary border-4 border-neutral-50" />
            <div className="mb-4 flex justify-between items-start">
              <div>
                <h4 className="text-lg font-bold text-neutral-900">第 {idx + 1} 天</h4>
                <p className="text-sm text-neutral-500">{format(day, 'M月d日 (EEEE)', { locale: zhTW })}</p>
              </div>
              <Dialog>
                <DialogTrigger render={
                  <Button variant="ghost" size="sm" className="h-8 gap-1 text-primary hover:text-primary hover:bg-primary/5">
                    <Plus className="w-3.5 h-3.5" /> 新增活動
                  </Button>
                } />
                <DialogContent>
                  <AddItineraryForm trip={trip} onSubmit={onAdd} defaultDate={day} />
                </DialogContent>
              </Dialog>
            </div>

            <div className="space-y-3">
              {dayItems.length > 0 ? (
                dayItems.map(item => (
                  <motion.div 
                    key={item.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white p-4 rounded-xl border shadow-sm flex items-start gap-4 group"
                  >
                    <div className="bg-neutral-100 p-2 rounded-lg text-neutral-600">
                      {TYPE_ICONS[item.type]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start">
                        <h5 className="font-semibold text-neutral-900 truncate">{item.title}</h5>
                        <div className="flex items-center gap-1">
                          <button 
                            onClick={() => onEdit(item)}
                            className="p-1 text-neutral-400 hover:text-primary sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                            title="編輯活動"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => onDelete(item.id, day)} 
                            className="p-1 text-red-400 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                            title="刪除活動"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-xs text-neutral-500">
                        <span className="flex items-center gap-1 bg-neutral-100 px-1.5 py-0.5 rounded text-[10px] font-bold text-neutral-600">
                          {TYPE_LABELS[item.type]}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {format(item.startTime, 'HH:mm')}
                          {item.endTime && format(item.endTime, 'HH:mm') !== format(item.startTime, 'HH:mm') && ` - ${format(item.endTime, 'HH:mm')}`}
                        </span>
                        {item.location && (
                          <a 
                            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.location)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-blue-600 hover:text-blue-800 transition-colors font-medium"
                          >
                            <MapPin className="w-3 h-3" />
                            {item.location}
                          </a>
                        )}
                      </div>
                      {item.notes && (
                        <p className="mt-2 text-xs text-neutral-600 bg-neutral-50 p-2 rounded border border-neutral-100 italic">
                          {item.notes}
                        </p>
                      )}
                    </div>
                  </motion.div>
                ))
              ) : (
                <p className="text-sm text-neutral-400 italic">這天暫無行程規劃。</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ExpenseList({ expenses, baseCurrency, convertToMain, onDelete }: { expenses: Expense[], baseCurrency: string, convertToMain: (a: number, f: string, t: string) => number, onDelete: (id: string) => void }) {
  if (expenses.length === 0) {
    return (
      <div className="text-center py-20 border-2 border-dashed rounded-2xl border-neutral-200">
        <DollarSign className="w-12 h-12 text-neutral-300 mx-auto mb-4" />
        <p className="text-neutral-500">暫無開支記錄。</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {expenses.map((expense) => {
        const converted = convertToMain(expense.amount, expense.currency || 'USD', baseCurrency);
        const isDifferentCurrency = (expense.currency || 'USD') !== baseCurrency;

        return (
          <motion.div
            key={expense.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white p-4 rounded-xl border shadow-sm flex items-center justify-between group"
          >
            <div className="flex items-center gap-4">
              <div 
                className="w-10 h-10 rounded-full flex items-center justify-center text-white"
                style={{ backgroundColor: CATEGORY_COLORS[expense.category] }}
              >
                <DollarSign className="w-5 h-5" />
              </div>
              <div>
                <h5 className="font-semibold text-neutral-900">{expense.description}</h5>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant="secondary" className="text-[10px] uppercase px-1.5 py-0 h-4 font-bold">
                    {CATEGORY_LABELS[expense.category]}
                  </Badge>
                  <span className="text-xs text-neutral-500">{format(expense.date, 'M月d日 HH:mm')}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="font-bold text-lg text-neutral-900">
                  {expense.currency || 'USD'} {expense.amount.toLocaleString()}
                </p>
                {isDifferentCurrency && (
                  <p className="text-[10px] text-neutral-400 font-medium">
                    ≈ {baseCurrency} {converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                )}
              </div>
              <button onClick={() => onDelete(expense.id)} className="p-2 text-red-400 hover:text-red-600">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
