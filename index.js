// ==========================================
// FILE: index.js | WorksPlus OS v3.8 Multi-SaaS
// ==========================================
const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const qrcode = require('qrcode');
const session = require('express-session');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 3000;

// מאגר משתמשים - כאן מוסיפים עוד חשבונות בעתיד
let users = { 
    "shlomo": { pass: "works2026", client: null, status: "OFFLINE", waName: "" },
    "user2": { pass: "pass2026", client: null, status: "OFFLINE", waName: "" } 
};

app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'works-multi-saas-key', resave: false, saveUninitialized: true }));

// פונקציית Keep-Alive למניעת הרדמה ב-Render
setInterval(() => {
  if (process.env.RENDER_EXTERNAL_URL) {
    http.get(process.env.RENDER_EXTERNAL_URL);
  }
}, 600000); 

async function sendChats(username) {
    const user = users[username];
    if (user && user.client && user.status === "CONNECTED") {
        try {
            const chats = await user.client.getChats();
            const data = chats.slice(0, 40).map(c => ({
                id: c.id._serialized,
                name: c.name || c.id.user,
                last: c.lastMessage ? c.lastMessage.body : ""
            }));
            io.to(username).emit('load_chats', data);
        } catch (e) { console.log("Fetch Error"); }
    }
}

function startClient(username) {
    if (users[username].client) return;

    const client = new Client({
        authStrategy: new LocalAuth({ clientId: username, dataPath: './sessions' }),
        puppeteer: { 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'] 
        }
    });

    client.on('qr', async (qr) => {
        const url = await qrcode.toDataURL(qr);
        io.to(username).emit('qr_update', url);
    });

    client.on('ready', async () => {
        users[username].status = "CONNECTED";
        const info = client.info;
        users[username].waName = info.pushname || "משתמש ווטסאפ";
        
        io.to(username).emit('status_update', { 
            number: info.wid.user, 
            waName: users[username].waName,
            connected: true 
        });
        sendChats(username);
    });

    client.on('message', (msg) => {
        io.to(username).emit('new_msg', { from: msg.from, body: msg.body });
    });

    client.initialize().catch(err => console.error(err));
    users[username].client = client;
}

app.get('/', (req, res) => {
    if (!req.session.username) return res.redirect('/login');
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/login', (req, res) => {
    res.send(`
        <body style="background:#0f172a;color:white;text-align:center;padding-top:100px;direction:rtl;font-family:sans-serif;">
            <h1 style="color:#38bdf8;">WorksPlus OS Cloud</h1>
            <div style="background:#1e293b; display:inline-block; padding:30px; border-radius:15px; border:1px solid #334155;">
                <form action="/login" method="POST">
                    <input name="user" placeholder="שם משתמש" style="padding:12px; margin:5px; border-radius:8px; border:none; width:200px;"><br>
                    <input name="pass" type="password" placeholder="סיסמה" style="padding:12px; margin:5px; border-radius:8px; border:none; width:200px;"><br>
                    <button style="background:#38bdf8; color:#0f172a; border:none; padding:12px 25px; border-radius:8px; cursor:pointer; font-weight:bold; margin-top:10px;">התחברות למערכת</button>
                </form>
            </div>
        </body>
    `);
});

app.post('/login', (req, res) => {
    const { user, pass } = req.body;
    if (users[user] && users[user].pass === pass) {
        req.session.username = user;
        startClient(user);
        res.redirect('/');
    } else res.send("שם משתמש או סיסמה שגויים");
});

io.on('connection', (socket) => {
    socket.on('join', (user) => { 
        socket.join(user);
        if(users[user] && users[user].status === "CONNECTED") {
            io.to(user).emit('status_update', { 
                number: users[user].client.info.wid.user, 
                waName: users[user].waName,
                connected: true 
            });
            sendChats(user);
        }
    });

    socket.on('get_history', async (data) => {
        const client = users[data.user].client;
        if(client) {
            try {
                const chat = await client.getChatById(data.chatId);
                const msgs = await chat.fetchMessages({ limit: 40 });
                socket.emit('load_history', msgs.map(m => ({ body: m.body, fromMe: m.fromMe })));
            } catch (e) { console.log("History error"); }
        }
    });

    socket.on('send_msg', async (data) => {
        const client = users[data.user].client;
        if(client) {
            const target = data.to.includes('@') ? data.to : `${data.to}@c.us`;
            await client.sendMessage(target, data.body);
        }
    });
});

server.listen(port, () => console.log(`🚀 WorksPlus Multi-SaaS Live`));