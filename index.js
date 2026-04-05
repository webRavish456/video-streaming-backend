import "dotenv/config";
import http from "http";
import express from 'express';
import { connectDB } from './src/db/mongo-db-connect.js';
import cors from 'cors';
import compression from 'compression';
import { router as Router } from './src/routes/routes.js';
import { attachSocketServer } from './src/socket/attachSocketServer.js';

const PORT = process.env.PORT || 8000;
const app = express();

app.use(
  cors({
    exposedHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
  })
);
app.use(
  compression({
    filter: (req, res) => {
      if (String(req.url).includes('/videos/') && String(req.url).includes('/stream')) {
        return false;
      }
      return compression.filter(req, res);
    },
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }))


connectDB()

app.use("/api", Router);

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (res.headersSent) {
    next(err);
    return;
  }
  const status = Number(err?.status || err?.statusCode) || 500;
  const msg =
    err?.message ||
    (typeof err === "string" ? err : "Something went wrong on the server.");
  res.status(status).json({
    status: "error",
    message: String(msg).slice(0, 500),
  });
});

const server = http.createServer(app);
attachSocketServer(server);

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});