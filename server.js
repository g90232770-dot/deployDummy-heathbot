import express from "express"
import path from "path"
import { fileURLToPath } from "url"
import axios from "axios"
import dotenv from 'dotenv'
// import bodyParser from "body-parser"
import mongoose from "mongoose"
import ChatHistory from "./models/QA.js" // schema
// import dns from "dns"

const app = express();
dotenv.config(); // Loads .env into process.env
const PORT = process.env.PORT || 5000;
// dns.setServers(["1.1.1.1", "8.8.8.8"])

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY_TWO;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const TELEGRAM_SECRET = process.env.TELEGRAM_SECRET;
const FREE_AI_NAMES = [process.env.FREE_AI_NAME, process.env.FREE_AI_NAME2, process.env.FREE_AI_NAME3, process.env.FREE_AI_NAME4];


// ,{
//   useNewUrlParser: true,
//   useUnifiedTopology: true,
// }
mongoose.connect(process.env.MONGODB_URI).then(() => {
  console.log("MongoDB connected");
}).catch((err) => {
  console.error("MongoDB connection error:", err);
});

// setting up a middleware
async function checkCache(req, res, next) {
  const { mess, mod, hist } = req.body;

  // validation
  if (!mess[1].content || mess.length < 2 || !mod) {
    return res.status(400).json({ data: "Missing question" });
  }

  req.question = mess[1].content;
  req.model = mod;
  req.useHistory = hist;

  if (hist) {
    try {
      const history = await ChatHistory.findOne({ question: req.question, model: req.model });
      if (history) {
        return res.status(200).json({ data: history.answer, fromCache: true });
      }
    } catch (err) {
      // console.error("Cache check failed:", err.message);
      console.error("Cache check failed:");
      // don’t block the request if DB fails → continue to API
    }
  }

  next(); // pass control to the route
}

// call api
const callOpenRouter = async (req, res, next) => {
  try {
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: req.model,
        messages: req.body.mess,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const answer = response.data?.choices?.[0]?.message?.content || "";
    // const answer = "checking for prototype";

    // Save to DB if not already saved
    const exists = await ChatHistory.findOne({
      question: req.question,
      model: req.model,
    });

    if (!exists) {
      await new ChatHistory({
        question: req.question,
        answer,
        model: req.model,
      }).save();
    }

    req.answer = answer; // pass result forward
    next();
  } catch (error) {
    console.error("Error in callOpenRouter:", error?.response?.data || error.message); 
    // console.error("Error in callOpenRouter");
    res.status(500).json({ data: "Failed to call AI service" });
  }
}

// Serve static files from React build
app.use(express.static(path.join(__dirname, "dist")));
// for req body
// app.use(bodyParser.json()); // to parse Telegram JSON requests
app.use(express.json());

app.get("/get-ai-list", async (req, res) => {
  res.status(200).json({names: FREE_AI_NAMES})
})

// openrouter api
app.post("/api/chat", checkCache, callOpenRouter, async (req, res) => {
  res.status(200).json({ data: req.answer, fromCache: false });
});

// Webhook endpoint for telegram
app.post(`/telegram-webhook/superSecret123SYNERCN8N4CR8NR9N`, async (req, res) => {
  
  try {
      if (!req.body || !req.body.message) {
        return res.sendStatus(400);
      }

    const chatId = req.body.message.chat.id;
    const question = req.body.message.text?.trim().toLowerCase();

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: FREE_AI_NAMES[0],
        messages: [
              {
                role: "system",
                content: "You are a helpful health assistant. You can explain general uses of medicines, basic health tips, and give general awareness about symptoms. ⚠️ Always add: 'This is not medical advice. Please consult a qualified doctor for proper diagnosis or treatment.' Never give dosage or prescriptions.",
              },
              { role: "user", content: question },
            ],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const answer = response.data?.choices?.[0]?.message?.content || "";
    // const answer = "checking for telegram prototype";

    // Save to DB if not already saved
    const exists = await ChatHistory.findOne({ 
      question: question,
      model: FREE_AI_NAMES[0],
    });

    if (!exists) {
      await new ChatHistory({
        question: question,
        answer,
        model: FREE_AI_NAMES[0],
      }).save();
    }

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: answer,
    });

    res.status(200).send("ok");
  } catch {
    console.error("❌ Error in webhook:", error.response?.data || error.message);

    // Tell Telegram something went wrong
    if (req.body?.message?.chat?.id) {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: req.body.message.chat.id,
        text: "⚠️ Sorry, I’m having trouble answering right now.",
      });
    }
    res.sendStatus(500);
  }
});

// Catch-all: send index.html for React Router routes
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "dist","index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
