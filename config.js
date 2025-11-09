// config.js
import dotenv from "dotenv";
dotenv.config();

export const config = {
  apiKey: process.env.API_KEY,
  clientCode: process.env.CLIENT_CODE,
  mpin: process.env.MPIN,
  totpSecret: process.env.TOTP_SECRET,
  secretKey: process.env.SECRET_KEY
};

  