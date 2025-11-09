// fetchData.js
import { smartConnect } from "./main.js";
import fs from "fs/promises";
import https from "https";
import { downloadScripMaster, findSymbolToken, formatToIST } from "./utlis.js";

export async function fetchLast20DaysDailyCandles(tradingsymbol, exchange) {
  try {
    const sessionData = await smartConnect();
    if (!sessionData) throw new Error("Login failed");

    const { smart_api } = sessionData;

    // get token
    const master = await downloadScripMaster();
    const token = master ? findSymbolToken(master, exchange, tradingsymbol) : null;
    const symboltoken = token || "2885"; // fallback RELIANCE token

    const offsetMs = 330 * 60 * 1000; // IST offset
    const nowUtcMs = Date.now();
    const nowIstMs = nowUtcMs + offsetMs;
    const now = new Date(nowIstMs);

    // Helper to get date string in IST format for SmartAPI
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

    // Helper to find previous trading day (skip weekends)
    function getPreviousTradingDay(date) {
      let d = new Date(date);
      d.setDate(d.getDate() - 1);
      while (d.getDay() === 0 || d.getDay() === 6) {
        d.setDate(d.getDate() - 1);
      }
      return d;
    }

    // Collect candles until we have 20 valid trading days
    let collected = [];
    let toDate = now;
    let safety = 0;

    while (collected.length < 20 && safety < 60) {
      safety++;

      // get past 30 days (for buffer)
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

      // move window back by 30 more days to ensure we cross holidays/weekends
      toDate = getPreviousTradingDay(fromDate);
    }

    // Sort by timestamp and keep only the latest 20 candles
    collected = collected
      .sort((a, b) => new Date(a[0]) - new Date(b[0]))
      .slice(-20);

    if (collected.length < 20) {
      console.warn(`⚠️ Only ${collected.length} daily candles found.`);
    } else {
      console.log(`✅ Fetched ${collected.length} valid daily candles.`);
    }

    // Remove timestamp → return [open, high, low, close, volume]
    const dataOnly = collected.map((row) => row.slice(1));
    return dataOnly;
  } catch (err) {
    console.error("Error in fetchLast20DaysDailyCandles:", err);
    return [];
  }
}


/**
 * 🕐 Fetch last 20 candles of 5-minute interval (handles market hours)
 */
export async function fetchLast20FiveMinCandlesRobust(tradingsymbol, exchange) {
    try {
      const sessionData = await smartConnect();
      if (!sessionData) throw new Error("Login failed");
  
      const { smart_api } = sessionData;
  
      // get token
      const master = await downloadScripMaster();
      const token = master ? findSymbolToken(master, exchange, tradingsymbol) : null;
      const symboltoken = token || "2885"; // fallback RELIANCE
  
      const offsetMs = 330 * 60 * 1000; // IST offset
      const nowUtcMs = Date.now();
      const nowIstMs = nowUtcMs + offsetMs; // instant expressed in IST epoch ms
      const istNow = new Date(nowIstMs);
      const istHour = istNow.getUTCHours();    // use UTC getters because we shifted ms
      const istMinute = istNow.getUTCMinutes();
      const istDay = istNow.getUTCDay(); // 0=Sun,6=Sat
  
      // helpers
      const makeISTSessionBoundsMs = (year, monthIndex, day, hour, minute) => {
        // create UTC ms for the time that corresponds to IST YYYY-MM-DD hour:minute
        // UTC ms = Date.UTC(year, monthIndex, day, hour, minute) - offsetMs
        return Date.UTC(year, monthIndex, day, hour, minute) - offsetMs;
      };
  
      const getISTDatePartsFromMs = (ms) => {
        const d = new Date(ms + offsetMs);
        return { year: d.getUTCFullYear(), monthIndex: d.getUTCMonth(), day: d.getUTCDate() };
      };
  
      const sessionOpenHour = 9, sessionOpenMin = 15;
      const sessionCloseHour = 15, sessionCloseMin = 30;
  
      // is current IST inside session?
      const isInSession = (istHour > sessionOpenHour || (istHour === sessionOpenHour && istMinute >= sessionOpenMin))
                         && (istHour < sessionCloseHour || (istHour === sessionCloseHour && istMinute <= sessionCloseMin))
                         && istDay !== 0 && istDay !== 6;
  
      // fetch helper that calls SmartAPI and returns resp.data (array of rows) or []
      async function fetchRange(fromMs, toMs) {
        const fromdate = formatToIST(new Date(fromMs));
        const todate = formatToIST(new Date(toMs));
        // console.log("fetchRange", fromdate, todate);
        const resp = await smart_api.getCandleData({
          exchange,
          symboltoken: String(symboltoken),
          interval: "FIVE_MINUTE",
          fromdate,
          todate,
        });
        return (resp && Array.isArray(resp.data)) ? resp.data : [];
      }
  
      // helper to get previous trading day (skip Sat/Sun)
      function getPreviousTradingDayMs(referenceIstMs) {
        // referenceIstMs is IST ms (UTCms + offset)
        let { year, monthIndex, day } = getISTDatePartsFromMs(referenceIstMs);
        let prev = new Date(Date.UTC(year, monthIndex, day, 0, 0) - offsetMs); // start of that IST day as Date obj
        // go back one calendar day until not Sat/Sun
        do {
          prev = new Date(prev.getTime() - 24 * 60 * 60 * 1000);
          ({ year, monthIndex, day } = getISTDatePartsFromMs(prev.getTime() + offsetMs));
        } while (new Date(prev.getTime() + offsetMs).getUTCDay() === 0 || new Date(prev.getTime() + offsetMs).getUTCDay() === 6);
        // return ms for that date's midnight IST (ms value currently is UTCms for midnight IST)
        return prev.getTime() + offsetMs; // return IST ms for that day's 00:00
      }
  
      // Build a list and collect candles until we have 20
      let collected = [];
  
      // 1) If in session -> fetch from max(sessionOpenToday, now - 100min) to now
      if (isInSession) {
        // session open for today
        const { year, monthIndex, day } = getISTDatePartsFromMs(nowIstMs);
        const sessionOpenMsUTC = makeISTSessionBoundsMs(year, monthIndex, day, sessionOpenHour, sessionOpenMin);
        const sessionOpenIstMs = sessionOpenMsUTC + offsetMs; // IST ms for open
        // compute from (can't be before session open)
        const requestedFromIstMs = Math.max(nowIstMs - 20 * 5 * 60 * 1000, sessionOpenIstMs);
        const respNow = await fetchRange(requestedFromIstMs - offsetMs, nowUtcMs); // fetchRange expects UTC Date instances created by formatToIST(new Date(msUTC))
        // Explanation: fetchRange expects Date objects (UTC), so we pass UTC ms: msUTC = ISTms - offsetMs
        // respNow contains arrays with timestamp first element
        if (respNow.length) {
          collected = collected.concat(respNow);
        }
        // If still less than 20, fetch previous trading day sessions
        let needed = 20 - collected.length;
        let prevDayIstMidnightMs = getPreviousTradingDayMs(nowIstMs); // returns IST ms for previous day midnight
        while (needed > 0) {
          // get prev day open and close UTC ms
          const dParts = getISTDatePartsFromMs(prevDayIstMidnightMs);
          const prevOpenUTCms = makeISTSessionBoundsMs(dParts.year, dParts.monthIndex, dParts.day, sessionOpenHour, sessionOpenMin);
          const prevCloseUTCms = makeISTSessionBoundsMs(dParts.year, dParts.monthIndex, dParts.day, sessionCloseHour, sessionCloseMin);
          const prevResp = await fetchRange(prevOpenUTCms, prevCloseUTCms);
          if (prevResp && prevResp.length) {
            // append last N from prevResp
            const take = Math.min(needed, prevResp.length);
            // take last 'take' candles from prevResp
            const sliceStart = Math.max(0, prevResp.length - take);
            const neededFromPrev = prevResp.slice(sliceStart);
            // prepend required previous-candles before current session candles (older first)
            collected = neededFromPrev.concat(collected);
            needed = 20 - collected.length;
          } else {
            // no data found for prev day (maybe holiday) -> go back another day
            // move prevDayIstMidnightMs back one day
            prevDayIstMidnightMs = prevDayIstMidnightMs - 24 * 60 * 60 * 1000;
            // skip weekends
            while (new Date(prevDayIstMidnightMs + offsetMs).getUTCDay() === 0 || new Date(prevDayIstMidnightMs + offsetMs).getUTCDay() === 6) {
              prevDayIstMidnightMs -= 24 * 60 * 60 * 1000;
            }
            // continue loop
          }
          // safety break to avoid infinite loop
          if (prevDayIstMidnightMs < nowIstMs - 365 * 24 * 60 * 60 * 1000) break;
        }
      } else {
        // 2) Market closed -> fetch previous trading day's full session (9:15 - 15:30)
        let prevDayIstMidnightMs = getPreviousTradingDayMs(nowIstMs); // IST ms of prev trading day midnight
        let needed = 20;
        while (needed > 0) {
          const dParts = getISTDatePartsFromMs(prevDayIstMidnightMs);
          const prevOpenUTCms = makeISTSessionBoundsMs(dParts.year, dParts.monthIndex, dParts.day, sessionOpenHour, sessionOpenMin);
          const prevCloseUTCms = makeISTSessionBoundsMs(dParts.year, dParts.monthIndex, dParts.day, sessionCloseHour, sessionCloseMin);
          const prevResp = await fetchRange(prevOpenUTCms, prevCloseUTCms);
          if (prevResp && prevResp.length) {
            // take last required from this day's session
            const take = Math.min(needed, prevResp.length);
            const sliceStart = Math.max(0, prevResp.length - take);
            const taken = prevResp.slice(sliceStart);
            // prepend (older first)
            collected = taken.concat(collected);
            needed = 20 - collected.length;
            if (needed <= 0) break;
          }
          // move one trading day back
          prevDayIstMidnightMs -= 24 * 60 * 60 * 1000;
          while (new Date(prevDayIstMidnightMs + offsetMs).getUTCDay() === 0 || new Date(prevDayIstMidnightMs + offsetMs).getUTCDay() === 6) {
            prevDayIstMidnightMs -= 24 * 60 * 60 * 1000;
          }
          // safety limit
          if (prevDayIstMidnightMs < nowIstMs - 365 * 24 * 60 * 60 * 1000) break;
        }
      }
  
      // Ensure we have at most 20 candles and take the most recent 20
      if (collected.length > 20) {
        collected = collected.slice(-20);
      }
  
      // If still less than 20, warn and return whatever we have
      if (collected.length < 20) {
        console.warn(`Only ${collected.length} candles found (expected 20).`);
      }
  
      // remove timestamp and return array of [open, high, low, close, volume]
      const dataOnly = collected.map(row => row.slice(1));
      return dataOnly;
    } catch (err) {
      console.error("Error in fetchLast20FiveMinCandlesRobust:", err);
      return [];
    }
  }
