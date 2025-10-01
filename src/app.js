// backend/src/app.js
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const http = require("http");
require("dotenv").config();
const { Server } = require("socket.io");
const { TeacherLogin } = require("./controllers/login");
const { createPoll, voteOnOption, getPolls } = require("./controllers/poll");

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PORT || 3000;
const DB = process.env.MONGODB_URL;

mongoose
  .connect(DB)
  .then(() => console.log("Connected to MongoDB"))
  .catch((e) => console.error("Failed to connect to MongoDB:", e));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: ["https://pollingsystem-himank.vercel.app"], methods: ["GET", "POST"], credentials: true },
});

// In-memory state for currently-active poll and connected users
let activePoll = null;
let votes = {};
let connectedUsers = {}; // socketId -> username

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Provide active poll to late joiners (callback style)
  socket.on("getActivePoll", (callback) => {
    if (activePoll && Date.now() < activePoll.endTime) {
      callback(activePoll);
    } else {
      callback(null);
    }
  });

  // Teacher creates poll
  socket.on("createPoll", async (pollData) => {
    votes = {};
    const endTime = Date.now() + pollData.timer * 1000;
    const poll = await createPoll(pollData);

    // Build activePoll object (plain POJO)
    activePoll = {
      ...poll._doc,
      votes,
      endTime,
    };

    console.log("Poll created:", activePoll._id, "ends at", new Date(endTime).toISOString());
    io.emit("pollCreated", activePoll);

    // Server-side timer to end poll
    if (activePoll) {
      setTimeout(() => {
        if (activePoll && activePoll._id.toString() === poll._id.toString()) {
          io.emit("pollEnded", { pollId: poll._id });
          console.log("Poll ended:", poll._id);
          activePoll = null;
        }
      }, pollData.timer * 1000);
    }
  });

  // Student submits answer
  socket.on("submitAnswer", (answerData) => {
    // ignore if no active poll or expired
    if (!activePoll || Date.now() > activePoll.endTime) return;

    votes[answerData.option] = (votes[answerData.option] || 0) + 1;
    // Persist to DB
    voteOnOption(answerData.pollId, answerData.option);

    activePoll.votes = votes;
    io.emit("pollResults", votes);
  });

  // Teacher kicks out a participant (username passed)
  socket.on("kickOut", (usernameToKick) => {
    console.log("Kick request for:", usernameToKick);
    for (let id in connectedUsers) {
      if (connectedUsers[id] === usernameToKick) {
        console.log("Found socket to kick:", id, "username:", usernameToKick);

        // Emit kickedOut event to the target socket **first**
        io.to(id).emit("kickedOut", { message: "You have been kicked out by the teacher." });

        // Give the client a short time to handle the event and redirect
        setTimeout(() => {
          try {
            const userSocket = io.sockets.sockets.get(id);
            if (userSocket) {
              // Optionally disconnect after event is sent so server state is clean
              userSocket.disconnect(true);
            }
          } catch (err) {
            console.error("Error disconnecting kicked socket:", err);
          }
        }, 250); // 250ms delay to allow client to receive the event

        // Remove from connectedUsers map
        delete connectedUsers[id];
        break;
      }
    }

    // Broadcast updated participants list to everyone
    io.emit("participantsUpdate", Object.values(connectedUsers));
  });

  // User joins chat/poll (clients should emit this when they open the chat/page)
  socket.on("joinChat", ({ username }) => {
    console.log("joinChat:", username, "->", socket.id);
    connectedUsers[socket.id] = username;
    io.emit("participantsUpdate", Object.values(connectedUsers));
  });

  // Quick login echo (if used)
  socket.on("studentLogin", (name) => {
    socket.emit("loginSuccess", { message: "Login successful", name });
  });

  // Chat messages broadcast
  socket.on("chatMessage", (message) => {
    io.emit("chatMessage", message);
  });

  // Clean up on disconnect
  socket.on("disconnect", (reason) => {
    console.log("User disconnected:", socket.id, "reason:", reason);
    delete connectedUsers[socket.id];
    io.emit("participantsUpdate", Object.values(connectedUsers));
  });
});

app.get("/", (req, res) => res.send("Polling System Backend"));

app.post("/teacher-login", (req, res) => TeacherLogin(req, res));
app.get("/polls/:teacherUsername", (req, res) => getPolls(req, res));

server.listen(port, () => console.log(`Server running on port ${port}...`));
