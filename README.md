# 🎀 Nino Discord Bot


## 📋 Overview

**Nino Bot** is an interactive Discord bot that combines a complex economy system with an AI-driven relationship simulator. Players interact with Nino, a virtual character, through various activities, mini-games, and social features. The bot includes a sophisticated money system, rare item collection, marketplace, and affection tracking.

---

## ✨ Core Features

### 💰 Economy System
- **Money Management**: Earn and spend currency (Yên)
- **Bank System**: Deposit money with automatic 5% daily interest
- **Fishing**: Catch fish at regular intervals for income (`/cauca`)
- **Work Command**: Regular employment opportunities with bonus events (`/work`)
- **Daily Rewards**: Claim daily login bonuses (`/daily`)
- **Loan System**: Borrow money from "the gang" with consequences for non-payment

### 🎁 Item & Collection System
- **Regular Shop**: Rotating inventory of gifts to present to Nino (`/shop`)
- **Rare Item Exploration**: Discover unique items through adventures (`/khampha`)
- **Marketplace**: Player-to-player trading platform with NPC fallback (`/market`)
- **Item Gifting**: Give items to Nino to increase affection points (`/gift`)

### 👑 Social & Affection System
- **Affection Ranks**: Unlock special title rewards as your relationship grows
- **Titles/Badges**: Purchasable titles that unlock Discord roles (`/danhhieu`)
- **Profile System**: Display achievements, badges, and relationship milestones (`/profile`)
- **Leaderboards**: Global affection ranking system (`/top`)

### 🎮 Mini-Games
- **Dice Game (Tài Xỉu)**: Roll dice to win or lose money (`/taixiu`)
- **Date System**: Interactive story-driven dates with Nino (`/date`)
- **AI Story Generation**: Unique narratives created via Groq AI for each date event

### 💳 Special Features
- **Name Color Customization**: Purchase custom Discord role colors (`/doimau`)
- **Insurance**: Protect yourself from loan default penalties (`/baohiem`)
- **Money Transfers**: Send currency to other players with transaction fees (`/transfer`)
- **Item Gifts**: Directly gift rare items to friends (`/give`)

### 🎯 System Features
- **Money Sink Mechanics**: Various sinks prevent inflation:
  - Market trading taxes (5%)
  - Transfer fees (3%)
  - Title purchases
  - Name color customization
- **Cooldown Reminders**: DM notifications when abilities are ready
- **Automatic Interest**: Bank interest applies even while offline
- **Transaction Logging**: Complete audit trail of all economic activity

---

## 🛠️ Commands

### User Profile
```
/profile      - View your full profile with achievements
/affection    - Check your affection level with Nino
/inv          - View your inventory and rare items
/top          - Global affection leaderboard (Top 10)
```

### Income Activities
```
/work         - Work for money (5 min cooldown)
/cauca        - Fish for income (10 min cooldown)
/khampha      - Explore for rare items (30 min cooldown)
/daily        - Daily login bonus (24 hour cooldown)
/taixiu       - Dice gambling game
```

### Shopping & Trading
```
/shop         - Browse rotating gift shop
/gift         - Gift items to Nino
/danhhieu     - Purchase titles and badges
/market sell  - List rare items for sale
/market list  - View marketplace listings
/market buy   - Purchase items from players
/market cancel - Remove your listing
```

### Economy
```
/bank deposit <amount>  - Deposit money (earn interest)
/bank withdraw <amount> - Withdraw from savings
/transfer <user> <amount> - Send money to another player
/give <user> <item_id>  - Gift rare items to friends
```

### Customization
```
/doimau <hex_color> - Change your Discord name color
/baohiem            - Purchase loan default insurance
```

### Social
```
/date   - Go on an interactive date with Nino
```

### Utility
```
/help - Display all available commands
```

---

## 📦 Dependencies

- **discord.js** (v14.27.0) - Discord bot framework
- **groq-sdk** (v0.5.0) - AI integration for story generation
- **dotenv** (v16.6.1) - Environment variable management

Install with:
```bash
npm install
```

---

## 🔧 Setup & Configuration

### Prerequisites
- Node.js 18+
- Discord Bot Token
- Groq API Key
- Discord Server with admin permissions

### Environment Variables (.env)
```env
DISCORD_TOKEN=your_bot_token_here
GROQ_API_KEY=your_groq_api_key_here
ANNOUNCEMENT_CHANNEL_ID=channel_id_for_announcements
MODEL=mixtral-8x7b-32768  # or other Groq model
```

### Installation
```bash
1. Clone the repository
2. npm install
3. Create .env file with required credentials
4. node index.js  # or use pm2/forever for persistence
```

---

## 💾 Data Structure

### User Data (game_data.json)
```json
{
  "users": {
    "user_id": {
      "points": 0,              // Affection points with Nino
      "money": 0,               // Current cash in wallet
      "bank": 0,                // Money in savings
      "bank_last_interest": 0,  // Timestamp of last interest calculation
      "inv": [],                // Regular items (gifts)
      "rareItems": [],          // Rare collectible items
      "titles": [],             // Purchased badges/titles
      "last_daily": 0,          // Last daily login timestamp
      "last_fish": 0,           // Last fishing timestamp
      "last_kham": 0,           // Last exploration timestamp
      "last_transfer": 0,       // Last money transfer timestamp
      "loan": {
        "status": "none",       // "active" or "none"
        "borrowed_at": 0,
        "last_borrowed": 0
      },
      "disabled_until": 0,      // Ban timestamp if in debt
      "insurance": false,       // Loan default protection
      "fish_caught": 0,         // Total fish caught
      "total_rare_found": 0     // Total rare items found
    }
  },
  "shop": {
    "current_items": [],        // Currently available shop items
    "next_refresh": 0           // Next shop rotation time
  },
  "market": {
    "listings": []              // Active player-to-player sales
  },
  "economy": {
    "total_sink": 0,            // Total money removed from circulation
    "total_fishing_income": 0,  // Sum of all fishing earnings
    "total_fish_caught": 0      // Total fish caught globally
  },
  "transactionLog": []          // Complete transaction history
}
```

---

## 🎯 Game Mechanics

### Affection System
- **Thresholds**: Different affection ranks unlock at certain point milestones
- **Title Rewards**: Purchase titles to permanently increase affection
- **Date Events**: Completing dates grants bonus affection
- **Gifting**: Present items to Nino for affection increases

### Loan Mechanics
- **Borrow**: Get 2,000 Yên with 10-minute repayment window
- **Default**: Automatic account ban and asset seizure if time expires
- **Insurance**: Protection item prevents default consequences once
- **Payoff**: Repay before cooldown expires to unlock regular gameplay

### Rare Item System
- **Discovery**: `/khampha` generates unique items via AI
- **Rarity Tiers**: Common, Uncommon, Rare, Epic, Legendary
- **Growth**: Items increase in value over time
- **Trading**: Sell to NPC or list on player marketplace
- **Pricing**: AI suggests prices with server-enforced limits (max 3x base value)

### Transaction Fees (Money Sink)
| Action | Fee | Purpose |
|--------|-----|---------|
| Market Purchase | 5% | Inflation control |
| Player Transfer | 3% | Spam prevention |
| Title Purchase | 100% | Money sink (entire cost) |
| Name Color | 100% | Money sink (entire cost) |

---

## 🤖 AI Integration

The bot uses **Groq API** for dynamic content generation:

- **Date Scenarios**: Personalized date narratives based on affection level
- **Shop Rotation**: AI-generated gift suggestions
- **Item Creation**: Unique rare item names and descriptions during exploration
- **Morning/Evening Greetings**: AI-generated server announcements

**Model**: Configured via `config.MODEL` (default: `mixtral-8x7b-32768`)

---

## 📊 Cooldown System

| Activity | Cooldown | Reward |
|----------|----------|--------|
| Work | 5 minutes | 2,000-5,500 Yên |
| Fishing | 10 minutes | 500-2,500 Yên |
| Exploration | 30 minutes | Variable rare items |
| Daily | 24 hours | 500-2,000 Yên |
| Dating | 1 hour | 40-150 affection points |
| Money Transfer | 1 minute | Variable |
| Loan | 1 per day | 2,000 Yên |

---

## 📈 Economy Overview

**Income Sources:**
- Fishing (lowest risk)
- Work (standard income)
- Exploration (rare items with long cooldown)
- Daily logins
- Dice gambling (high risk/reward)

**Sinks:**
- Shop purchases
- Title/Badge purchases
- Marketplace taxes
- Transfer fees
- Color customization

**Status Commands:**
```
/profile  - Check total assets
/bank    - View savings & interest
/inv     - See inventory value
/top     - Compare with other players
```

---

## 🔐 Security & Balance

- **Rate Limiting**: Cooldowns prevent exploit farming
- **Price Caps**: Marketplace items limited to 3x base value
- **Transaction Logging**: Full audit trail for all money movements
- **Asset Freezing**: Loan defaults trigger account suspension
- **Fee System**: Automatic wealth redistribution to economy sinks

---

## 🤝 Contributing

This is a personal project. Feel free to fork and customize for your own server!

---

## 📝 License

Not specified. Contact `truongdok7-png` for usage inquiries.

---

## 🎮 Quick Start for New Players

1. Use `/daily` for your first reward
2. Use `/work` to start earning money
3. Use `/shop` to buy a gift for Nino
4. Use `/gift` to present it and gain affection
5. Unlock titles with `/danhhieu` as you earn more money
6. Try `/date` for special date events (1 hour cooldown)
7. Use `/khampha` to find rare items (30 min cooldown)
8. List items on `/market` or trade with friends via `/transfer`

---

## 📞 Support

For issues or questions about this bot, contact the repository owner or check the code documentation.

**Happy gaming! 🎀**
