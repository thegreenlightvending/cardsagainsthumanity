# Cards Against Humanity - Complete Project Analysis

## 📁 Project Structure

```
cardsagainsthumanity/
├── src/
│   ├── pages/              # Main application pages
│   │   ├── LoginPage.jsx   # Authentication (email/guest)
│   │   ├── HomePage.jsx    # Landing page after login
│   │   ├── CreateRoomPage.jsx  # Create game room
│   │   ├── JoinRoomPage.jsx    # Join existing room
│   │   └── GamePage.jsx        # Main game interface (1072 lines)
│   ├── auth/               # Authentication system
│   │   ├── AuthProvider.jsx    # Auth context provider
│   │   └── RequireAuth.jsx    # Protected route wrapper
│   ├── lib/
│   │   └── supabase.js     # Supabase client initialization
│   ├── utils/
│   │   └── profileUtils.js # Profile creation utilities
│   ├── App.jsx             # Root component
│   ├── AppRouter.jsx       # React Router setup
│   └── main.jsx             # Application entry point
├── public/                 # Static assets
├── dist/                   # Build output
├── fix_rounds_schema.sql   # Database schema fix
├── fix_submissions_rls.sql # RLS policy fix
├── package.json            # Dependencies
├── vite.config.js          # Vite configuration
├── tailwind.config.js      # Tailwind CSS config
└── netlify.toml            # Netlify deployment config
```

## 🛠️ Technology Stack

### Frontend
- **React 19.2.0** - UI framework
- **Vite 7.2.4** - Build tool and dev server
- **React Router DOM 7.12.0** - Client-side routing
- **Tailwind CSS 3.4.17** - Utility-first CSS framework

### Backend
- **Supabase** - Backend-as-a-Service
  - Authentication (email/password, guest/anonymous)
  - PostgreSQL database
  - Row Level Security (RLS) policies
  - Real-time subscriptions (not currently used, using polling instead)

### Hosting
- **Netlify** - Static site hosting
- Environment variables configured in Netlify dashboard

## 🗄️ Database Schema (Supabase)

### Core Tables

1. **profiles**
   - `id` (UUID, FK to auth.users)
   - `username` (text)
   - `created_at` (timestamp)

2. **decks**
   - `id` (bigint, PK)
   - `name` (text)
   - `type` (text: 'clean' or 'normal')

3. **black_cards**
   - `id` (bigint, PK)
   - `deck_id` (bigint, FK)
   - `text` (text)
   - `pick` (integer)

4. **white_cards**
   - `id` (bigint, PK)
   - `deck_id` (bigint, FK)
   - `text` (text)

5. **rooms**
   - `id` (UUID, PK)
   - `party_leader` (UUID, FK to profiles)
   - `deck_id` (bigint, FK)
   - `status` (text: 'waiting' or 'playing')
   - `is_private` (boolean)
   - `password` (text, for private rooms)
   - `max_players` (integer)
   - `created_at` (timestamp)

6. **room_players**
   - `room_id` (UUID, FK)
   - `profile_id` (UUID, FK)
   - `is_judge` (boolean) ← **Judge flag**
   - `score` (integer, default 0)
   - `joined_at` (timestamp) ← **Used for player_order**

7. **rounds**
   - `id` (bigint, PK)
   - `room_id` (UUID, FK)
   - `black_card_id` (bigint, FK)
   - `judge_profile_id` (UUID, FK) ← **Judge source of truth**
   - `winner_profile_id` (UUID, FK, nullable)
   - `status` (text: 'submitting' or 'completed')
   - `ended_at` (timestamp, nullable)

8. **submissions**
   - `id` (bigint, PK)
   - `round_id` (bigint, FK)
   - `profile_id` (UUID, FK)
   - `white_card_id` (bigint, FK)

9. **player_hands**
   - `id` (bigint, PK)
   - `room_id` (UUID, FK)
   - `profile_id` (UUID, FK)
   - `white_card_id` (bigint, FK)

10. **messages**
    - `id` (bigint, PK)
    - `room_id` (UUID, FK)
    - `profile_id` (UUID, FK)
    - `content` (text)
    - `created_at` (timestamp)

## 🔐 Authentication Flow

```
User visits app
    ↓
AuthProvider checks session
    ↓
No session? → Redirect to /login
    ↓
LoginPage:
  - Email/password sign in
  - OR Guest/anonymous sign in
    ↓
Session created → Redirect to /
    ↓
HomePage (protected by RequireAuth)
```

## 🎮 Game Flow

### 1. **Room Creation** (`CreateRoomPage`)
- User selects deck (clean/normal)
- Sets room code/password (for private rooms)
- Creates room in database
- User becomes `party_leader`
- Redirects to game room

### 2. **Joining Room** (`JoinRoomPage`)
- Browse public rooms OR
- Enter room code for private room
- Joins `room_players` table
- Redirects to game room

### 3. **Game Room** (`GamePage`)
- **Waiting State**: Shows players, host can start game
- **Playing State**: Active game with rounds

### 4. **Round Flow**
```
Start Game
    ↓
Deal 10 cards to each player
    ↓
Create first round (first player = judge)
    ↓
Display black card
    ↓
Players submit white cards
    ↓
Judge sees all submissions
    ↓
Judge selects winner
    ↓
Point awarded to winner
    ↓
Round marked complete
    ↓
Wait 3 seconds
    ↓
nextRound() called
    ↓
Rotate judge (next player in order)
    ↓
Replenish cards to 10
    ↓
Create new round with new black card
    ↓
Repeat...
```

## 📊 State Management

### GamePage State Variables

```javascript
const [room, setRoom] = useState(null)              // Current room data
const [players, setPlayers] = useState([])          // All players in room
const [currentRound, setCurrentRound] = useState(null) // Active round
const [hasActiveRound, setHasActiveRound] = useState(false) // Round active flag
const [playerHand, setPlayerHand] = useState([])     // User's white cards
const [submissions, setSubmissions] = useState([])  // Submitted cards
const [messages, setMessages] = useState([])        // Chat messages
const [loading, setLoading] = useState(true)        // Loading state
const [error, setError] = useState("")              // Error messages
```

### Data Loading Strategy

- **Polling**: `loadGameData()` called every 2 seconds
- **Manual Refresh**: User can click "Refresh" button
- **Event-Driven**: Updates after user actions (submit card, select winner)

## 🔄 Key Functions in GamePage.jsx

### Game Control
- `startGame()` - Host starts the game
- `loadGameData()` - Polls database for game state
- `createActiveRound(judgeProfileId)` - Creates new round with judge
- `nextRound()` - Rotates judge and starts new round

### Player Actions
- `submitCard(cardId)` - Player submits white card
- `selectWinner(submissionId)` - Judge picks winning card
- `sendMessage(e)` - Send chat message

### Judge Selection Logic
- Uses `joined_at` order for consistent rotation
- Formula: `(currentIndex + 1) % totalPlayers`
- Updates both `room_players.is_judge` and `rounds.judge_profile_id`

## 🎯 Current Issues & Status

### ✅ Fixed
- Judge rotation logic
- Point awarding system
- RLS policies for submissions
- Database schema mismatches
- Round creation and loading

### ⚠️ Potential Issues
1. **Polling vs Realtime**: Currently using 2-second polling instead of Supabase Realtime
2. **Error Handling**: Some errors might be silently caught
3. **State Synchronization**: Multiple state updates could cause race conditions
4. **Card Replenishment**: Logic might not handle edge cases (deck running out)

## 🚀 Deployment

### Netlify Configuration
- Build command: `npm run build`
- Publish directory: `dist`
- Environment variables:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

### Local Development
```bash
npm install
npm run dev  # Starts on http://localhost:5173
```

## 📝 Code Quality

### Strengths
- Clear function separation
- Extensive console logging for debugging
- Error handling in critical paths
- Consistent naming conventions

### Areas for Improvement
- **GamePage.jsx is large** (1072 lines) - could be split into components
- **Polling frequency** - 2 seconds might be too slow/fast
- **Error messages** - Could be more user-friendly
- **Loading states** - Some operations don't show loading indicators

## 🔍 Security Considerations

1. **RLS Policies**: All tables have Row Level Security enabled
2. **Authentication**: All routes protected by `RequireAuth`
3. **Input Validation**: Room codes, messages validated
4. **Host Controls**: Only party_leader can start game

## 📈 Performance

- **Bundle Size**: Unknown (check with `npm run build`)
- **Database Queries**: Multiple queries per poll (could be optimized)
- **Re-renders**: State updates trigger full component re-renders
- **Polling**: 2-second interval = 30 requests/minute per user

## 🎨 UI/UX

- **Design**: Dark theme (zinc-950 background)
- **Responsive**: Uses Tailwind grid (lg:grid-cols-4)
- **Feedback**: Error messages, success notifications
- **Accessibility**: Could be improved (ARIA labels, keyboard navigation)

## 🔮 Future Enhancements

1. **Realtime Updates**: Switch from polling to Supabase Realtime
2. **Component Splitting**: Break GamePage into smaller components
3. **Game Settings**: Win condition, round limits
4. **Spectator Mode**: Allow watching games without playing
5. **Card History**: Show previously played cards
6. **Animations**: Smooth transitions between rounds
7. **Mobile Optimization**: Better touch interactions
8. **Offline Support**: Service worker for offline capability
