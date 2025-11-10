// fetchData.js
import { smartConnect } from "./main.js";
import fs from "fs/promises";
import https from "https";
import { downloadScripMaster, findSymbolToken, formatToIST } from "./utlis.js";

/**
 * 📅 Fetch last 40 trading days of daily candles
 */
export async function fetchLast26DaysDailyCandles(tradingsymbol, exchange) {
  try {
    const sessionData = await smartConnect();
    if (!sessionData) throw new Error("Login failed");

    const { smart_api } = sessionData;

    const master = await downloadScripMaster();
    const token = master ? findSymbolToken(master, exchange, tradingsymbol) : null;
    const symboltoken = token || "2885"; // fallback RELIANCE token

    const offsetMs = 330 * 60 * 1000; // IST offset
    const nowUtcMs = Date.now();
    const nowIstMs = nowUtcMs + offsetMs;
    const now = new Date(nowIstMs);

    const formatToIST = (date) => {
      const istMs = date.getTime() + 330 * 60000;
      const d = new Date(istMs);
      const YYYY = d.getUTCFullYear();
      const MM = String(d.getUTCMonth() + 1).padStart(2, "0");
      const DD = String(d.getUTCDate()).padStart(2, "0");
      const hh = String(d.getUTCHours()).padStart(2, "0");
      const mm = String(d.getUTCMinutes()).padStart(2, "0");
      return `${YYYY}-${MM}-${DD} ${hh}:${mm}`;
    };

    function getPreviousTradingDay(date) {
      let d = new Date(date);
      d.setDate(d.getDate() - 1);
      while (d.getDay() === 0 || d.getDay() === 6) {
        d.setDate(d.getDate() - 1);
      }
      return d;
    }

    // Collect candles until we have 40 valid trading days
    let collected = [];
    let toDate = now;
    let safety = 0;

    while (collected.length < 26 && safety < 60) {

      safety++;
      const fromDate = new Date(toDate);
      fromDate.setDate(fromDate.getDate() - 30);

      const fromdate = formatToIST(fromDate);
      const todate = formatToIST(toDate);

      const resp = await smart_api.getCandleData({
        exchange,
        symboltoken: String(symboltoken),
        interval: "ONE_DAY",
        fromdate,
        todate,
      });

      if (resp?.data?.length) {
        collected = resp.data.concat(collected);
      }

      // move window back
      toDate = getPreviousTradingDay(fromDate);
    }

    collected = collected
      .sort((a, b) => new Date(a[0]) - new Date(b[0]))
      .slice(-26);

    if (collected.length < 40) {
      console.warn(`⚠️ Only ${collected.length} daily candles found.`);
    } else {
      console.log(`✅ Fetched ${collected.length} valid daily candles.`);
    }

    const dataOnly = collected.map((row) => row.slice(1));
    return dataOnly;
  } catch (err) {
    console.error("Error in fetchLast40DaysDailyCandles:", err);
    return [];
  }
}

/**
 * 🕐 Fetch last 40 five-minute candles (robust across sessions)
 */
export async function fetchLast26FiveMinCandlesRobust(tradingsymbol, exchange) {
  try {
    const sessionData = await smartConnect();
    if (!sessionData) throw new Error("Login failed");

    const { smart_api } = sessionData;
    const master = await downloadScripMaster();
    const token = master ? findSymbolToken(master, exchange, tradingsymbol) : null;
    const symboltoken = token || "2885";

    const offsetMs = 330 * 60 * 1000; // IST offset
    const nowUtcMs = Date.now();
    const nowIstMs = nowUtcMs + offsetMs;
    const istNow = new Date(nowIstMs);
    const istHour = istNow.getUTCHours();
    const istMinute = istNow.getUTCMinutes();
    const istDay = istNow.getUTCDay();

    const makeISTSessionBoundsMs = (y, m, d, h, min) =>
      Date.UTC(y, m, d, h, min) - offsetMs;

    const getISTDatePartsFromMs = (ms) => {
      const d = new Date(ms + offsetMs);
      return { year: d.getUTCFullYear(), monthIndex: d.getUTCMonth(), day: d.getUTCDate() };
    };

    const sessionOpenHour = 9,
      sessionOpenMin = 15,
      sessionCloseHour = 15,
      sessionCloseMin = 30;

    const isInSession =
      (istHour > sessionOpenHour ||
        (istHour === sessionOpenHour && istMinute >= sessionOpenMin)) &&
      (istHour < sessionCloseHour ||
        (istHour === sessionCloseHour && istMinute <= sessionCloseMin)) &&
      istDay !== 0 &&
      istDay !== 6;

    async function fetchRange(fromMs, toMs) {
      const fromdate = formatToIST(new Date(fromMs));
      const todate = formatToIST(new Date(toMs));
      const resp = await smart_api.getCandleData({
        exchange,
        symboltoken: String(symboltoken),
        interval: "FIVE_MINUTE",
        fromdate,
        todate,
      });
      return resp?.data ?? [];
    }

    function getPreviousTradingDayMs(referenceIstMs) {
      let { year, monthIndex, day } = getISTDatePartsFromMs(referenceIstMs);
      let prev = new Date(Date.UTC(year, monthIndex, day, 0, 0) - offsetMs);
      do {
        prev = new Date(prev.getTime() - 24 * 60 * 60 * 1000);
        ({ year, monthIndex, day } = getISTDatePartsFromMs(prev.getTime() + offsetMs));
      } while (
        new Date(prev.getTime() + offsetMs).getUTCDay() === 0 ||
        new Date(prev.getTime() + offsetMs).getUTCDay() === 6
      );
      return prev.getTime() + offsetMs;
    }

    let collected = [];

    if (isInSession) {
      const { year, monthIndex, day } = getISTDatePartsFromMs(nowIstMs);
      const sessionOpenUTC = makeISTSessionBoundsMs(year, monthIndex, day, sessionOpenHour, sessionOpenMin);
      const sessionOpenIstMs = sessionOpenUTC + offsetMs;

      const requestedFromIstMs = Math.max(nowIstMs - 26 * 5 * 60 * 1000, sessionOpenIstMs);
      const respNow = await fetchRange(requestedFromIstMs - offsetMs, nowUtcMs);
      if (respNow.length) collected = collected.concat(respNow);

      let needed = 26 - collected.length;
      let prevDayMs = getPreviousTradingDayMs(nowIstMs);

      while (needed > 0) {
        const dParts = getISTDatePartsFromMs(prevDayMs);
        const prevOpenUTC = makeISTSessionBoundsMs(dParts.year, dParts.monthIndex, dParts.day, sessionOpenHour, sessionOpenMin);
        const prevCloseUTC = makeISTSessionBoundsMs(dParts.year, dParts.monthIndex, dParts.day, sessionCloseHour, sessionCloseMin);
        const prevResp = await fetchRange(prevOpenUTC, prevCloseUTC);

        if (prevResp.length) {
          const take = Math.min(needed, prevResp.length);
          collected = prevResp.slice(-take).concat(collected);
          needed = 40 - collected.length;
        } else {
          prevDayMs -= 24 * 60 * 60 * 1000;
        }
      }
    } else {
      let prevDayMs = getPreviousTradingDayMs(nowIstMs);
      let needed = 26;

      while (needed > 0) {
        const dParts = getISTDatePartsFromMs(prevDayMs);
        const prevOpenUTC = makeISTSessionBoundsMs(dParts.year, dParts.monthIndex, dParts.day, sessionOpenHour, sessionOpenMin);
        const prevCloseUTC = makeISTSessionBoundsMs(dParts.year, dParts.monthIndex, dParts.day, sessionCloseHour, sessionCloseMin);
        const prevResp = await fetchRange(prevOpenUTC, prevCloseUTC);

        if (prevResp.length) {
          const take = Math.min(needed, prevResp.length);
          collected = prevResp.slice(-take).concat(collected);
          needed = 40 - collected.length;
        }
        prevDayMs -= 24 * 60 * 60 * 1000;
      }
    }

    collected = collected.slice(-26);

    if (collected.length < 40) {
      console.warn(`⚠️ Only ${collected.length} five-min candles found.`);
    } else {
      console.log(`✅ Fetched ${collected.length} valid five-min candles.`);
    }

    const dataOnly = collected.map((row) => row.slice(1));
    return dataOnly;
  } catch (err) {
    console.error("Error in fetchLast40FiveMinCandlesRobust:", err);
    return [];
  }
}
