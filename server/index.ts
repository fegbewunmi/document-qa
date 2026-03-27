import express from "express";
import cors from "cors";
import queryRouter from "./routes/query";

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

app.use("/query", queryRouter);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
