# Quick Start - Group Chat Bot

Deploy WhatsApp group ordering bot in 1 hour.

## What You're Building

WhatsApp bot that works in **GROUP CHATS** where multiple customers can order simultaneously using text commands.

**Example:**
```
[Group: Restaurant Suppliers]

Customer A: /catalog
Bot: 📦 Products...

Customer A: /add 1 2
Bot: ✅ Added to your cart

Customer B: /search noodle
Bot: 🔍 Found 5 products...

Customer A: /confirm
Bot: ✅ Order #123 confirmed for Customer A
```

---

## Step 1: Meta Setup (20 min)

### Create Business Account
1. https://business.facebook.com
2. Create account → Submit verification docs
3. Wait 2-3 days (can test while pending)

### Create App
1. https://developers.facebook.com
2. My Apps → Create App → Business
3. Add WhatsApp product

### Get Credentials

Copy these 3 values:

**1. Phone Number ID**
- WhatsApp → Getting Started
- Look for "From" dropdown
- Copy the long number (e.g., `123456789012345`)

**2. Access Token**
- Temporary token shown on page (24h expiry)
- Later: generate permanent token in Business Settings → System Users

**3. Verify Token**
- **You create this** - any random string
- Example: `my_secret_verify_token_xyz123`
- Remember it - you'll use it twice (env var + Meta webhook config)

---

## Step 2: Deploy (15 min)

### Push to GitHub

```bash
cd whatsapp-group-bot
git init
git add .
git commit -m "WhatsApp group bot"

# Create repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/whatsapp-group-bot.git
git push -u origin main
```

### Deploy on Railway

1. https://railway.app → New Project
2. Deploy from GitHub repo
3. Add PostgreSQL:
   - New → Database → PostgreSQL
4. Add Environment Variables:
   - Click your app service → Variables tab
   - Add these:

```
PORT=3000
NODE_ENV=production
WEBHOOK_URL=https://your-app-name.up.railway.app
PHONE_NUMBER_ID=<paste from Step 1>
WHATSAPP_ACCESS_TOKEN=<paste from Step 1>
WEBHOOK_VERIFY_TOKEN=<paste from Step 1>
DATABASE_URL=<auto-filled by Railway>
```

**Important:**
- Copy your Railway URL from "Domains" section
- Update `WEBHOOK_URL` with your actual Railway URL

### Setup Database

Railway terminal:
```bash
npm run setup-db
```

This creates tables and loads sample products.

---

## Step 3: Connect Webhook (10 min)

1. Meta dashboard → Your App → WhatsApp → Configuration
2. Webhook → Edit:

```
Callback URL: https://your-railway-url.up.railway.app/webhook
Verify Token: my_secret_verify_token_xyz123
```

3. Click "Verify and Save" (should show green ✅)
4. Subscribe to field: **messages** ✅

---

## Step 4: Create Test Group (10 min)

### On WhatsApp:

1. **Create new group**
   - Name: "Test Orders" or whatever
   - Add yourself

2. **Add bot to group**
   - Add the WhatsApp Business number to group
   - Bot is now a member

3. **Test in group**

Send these messages in the group:

```
/start
```

Expected response:
```
👋 Hello! Welcome to our ordering system.

📋 Available Commands:
/catalog - Browse all products
/search [keyword] - Search products
/cart - View your cart
/help - Show all commands

Or just type a product name to search!
```

### Test Full Flow:

```
You: /catalog
Bot: [Shows all products by category]

You: /add 1 2
Bot: ✅ Added: Yee Fu Noodles x2
     
     📋 Your Cart:
     1. Yee Fu Noodles x2
     
     ✅ Type /confirm to place order

You: /confirm
Bot: ✅ Order Confirmed!
     
     📦 Order #1
     📅 [today's date]
     
     Items:
     1. Yee Fu Noodles x2
     
     ✅ We will confirm your order...
```

### Test Multiple Customers:

Add another person to group, have them:

```
Person B: /add 3 1
Bot: ✅ Added to your cart
     [Shows Person B's cart - separate from yours]

Person B: /confirm
Bot: ✅ Order #2 confirmed
     [Person B's order - not affecting your cart]
```

**Key point:** Each person has separate cart even in same group.

---

## Step 5: Test Private Chat (5 min)

1. From your personal WhatsApp, DM the business number directly
2. Send: `/start`
3. Bot responds same as in group
4. All commands work identically

**Both group and private chat work!**

---

## Commands Reference

### Must Know:
- `/catalog` - See all products
- `/add [id] [qty]` - Add to cart (e.g., `/add 5 2`)
- `/confirm` - Place order
- `/cart` - View cart
- `/help` - Show commands

### Optional:
- `/search noodle` - Search products
- `/repeat` - Repeat last order (after you've made one)
- `/clear` - Clear cart
- `/start` - Show welcome

### Shortcuts:
- Type `noodle` - Auto-searches (no need for `/search`)
- Type `hi` or `hello` - Same as `/start`

---

## Troubleshooting

### Webhook verification failed

**Error:** Red X when verifying webhook

**Fix:**
1. Check `WEBHOOK_VERIFY_TOKEN` in Railway matches token in Meta
2. Check Railway app is running (not crashed)
3. Check Railway URL is correct (HTTPS, not HTTP)
4. Try verify again

### Bot doesn't respond in group

**Check:**
1. Is bot phone number added to group as member? (Should show in member list)
2. Railway logs: `railway logs` - look for "Received text from..."
3. Send `/start` and wait 5 seconds
4. Check `WHATSAPP_ACCESS_TOKEN` is valid

### Bot responds in group but not private chat

This shouldn't happen - same code handles both.

**Check:**
1. Are you messaging the correct business number?
2. Railway logs - is it receiving the message?

### "/confirm" says "No pending order"

**You forgot to add items first!**

1. Send `/add 1 2` first
2. Then `/confirm`

Or:

1. Send `/repeat` (if you have past order)
2. Then `/confirm`

### Database error

**Check:**
```bash
railway run psql $DATABASE_URL -c "SELECT COUNT(*) FROM products;"
```

Should show number > 0

If error:
```bash
railway run npm run setup-db
```

---

## Load Your Products

### Option 1: Edit SQL File

1. Edit `schema.sql`
2. Replace sample products with yours
3. Run:
```bash
railway run psql $DATABASE_URL -f schema.sql
```

### Option 2: Direct SQL

Railway → PostgreSQL → Query:

```sql
-- Add category
INSERT INTO categories (name, description) VALUES 
('Your Category', 'Description');

-- Add products (get category_id from above)
INSERT INTO products (category_id, name, unit_size, is_active) VALUES
(1, 'Your Product 1', '1KG', true),
(1, 'Your Product 2', '500GM', true);
```

---

## Generate Permanent Access Token

Your temp token expires in 24 hours. Generate permanent:

1. Meta Business Settings → System Users
2. Create new system user: "WhatsApp Bot"
3. Add assets → Your app
4. Generate token with permissions:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
5. **Copy token** (never expires)
6. Update Railway variable: `WHATSAPP_ACCESS_TOKEN`

---

## What's Working Now

✅ Bot responds in groups  
✅ Bot responds in private chats  
✅ Multiple customers can order in same group  
✅ Each customer has separate cart  
✅ Product search works  
✅ Order history saved  
✅ Repeat order works  

---

## Next Steps

1. **Replace sample products** with your actual inventory
2. **Test with real team members** in a group
3. **Generate permanent access token** (temp expires 24h)
4. **Wait for business verification** (needed for production)
5. **Add bot to real customer groups**

---

## Production Checklist

Before going live:

- [ ] Business verification approved
- [ ] Permanent access token generated
- [ ] Real products loaded in database
- [ ] Tested in real group with 5+ people
- [ ] Tested multiple simultaneous orders
- [ ] Singapore phone number verified
- [ ] Railway app not on free tier (for serious traffic)

---

**Total Setup Time: ~1 hour**

✅ Meta setup: 20 min  
✅ Railway deploy: 15 min  
✅ Webhook config: 10 min  
✅ Group testing: 10 min  
✅ Private testing: 5 min  

**Bot is live and working!** 🚀

---

## Common Questions

**Q: Can customers use buttons?**  
A: No. WhatsApp doesn't support buttons in groups. Text commands only.

**Q: Are orders private?**  
A: No. All group members see orders. This is by design (transparent ordering).

**Q: Can I add bot to multiple groups?**  
A: Yes! Same bot works in any group it's added to.

**Q: How many customers per group?**  
A: No limit. Each customer has separate cart.

**Q: Does bot work in private chat too?**  
A: Yes! Same commands work in DMs.

**Q: Can I customize commands?**  
A: Yes. Edit `server.js` and add your commands.

---

Need help? Check `README.md` for full documentation.
