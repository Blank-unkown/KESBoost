/**
 * Import function triggers from their respective submodules:
 *
 * import {onCall} from "firebase-functions/v2/https";
 * import {onDocumentWritten} from "firebase-functions/v2/firestore";
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

import * as functions from "firebase-functions/v1";
import {HttpsError} from "firebase-functions/v1/https";
import {defineSecret} from "firebase-functions/params";

// Start writing functions
// https://firebase.google.com/docs/functions/typescript

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
// NOTE: This file uses 1st Gen callable functions to avoid unsupported
// in-place upgrades from 1st Gen to 2nd Gen.

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// export const helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });



export const generateQuestionsWithAI = functions
  .runWith({ secrets: [GEMINI_API_KEY] })
  .https
  .onCall(async (data) => {

  const apiKey = GEMINI_API_KEY.value();
  if (!apiKey) {
    throw new HttpsError(
      "failed-precondition",
      "Missing Gemini API key. Set it with: firebase functions:secrets:set GEMINI_API_KEY"
    );
  }

  const topic = String(data?.topic || "").trim();
  const competency = String(data?.competency || "").trim();
  const cognitiveLevel = String(data?.cognitiveLevel || "").trim();
  const count = Number(data?.count ?? 5);
  const mode = String(data?.mode || "mcq").trim();
  const customPrompt = String(data?.prompt || "").trim();

  if (!customPrompt && (!topic || !competency || !cognitiveLevel)) {
    throw new HttpsError("invalid-argument", "topic, competency, and cognitiveLevel are required");
  }

  const n = Number.isFinite(count) && count > 0 ? Math.min(Math.floor(count), 20) : 5;

  const prompt = customPrompt
    ? (
        `You are an exam question generator.\n` +
        `User request: ${customPrompt}\n\n` +
        `Return ONLY valid JSON.\n` +
        (mode === "mcq"
          ? `{"questions":[{"question":"...","choices":{"A":"...","B":"...","C":"...","D":"..."},"answer":"A"}]}`
          : `{"questions":["...","..."]}`)
      )
    : (
        `Generate ${n} exam questions.\n` +
        `Topic: ${topic}\n` +
        `Learning competency: ${competency}\n` +
        `Bloom level: ${cognitiveLevel}\n\n` +
        (mode === "mcq"
          ? (
              `Generate multiple-choice questions. Each item MUST include:\n` +
              `- question (string)\n` +
              `- choices (object with keys A,B,C,D and string values)\n` +
              `- answer (one of: \"A\",\"B\",\"C\",\"D\")\n\n` +
              `Return ONLY valid JSON in this exact format:\n` +
              `{"questions":[{"question":"...","choices":{"A":"...","B":"...","C":"...","D":"..."},"answer":"A"}]}`
            )
          : (
              `Return ONLY valid JSON in this exact format:\n` +
              `{"questions":["...","..."]}`
            ))
      );

  const listUrl =
    "https://generativelanguage.googleapis.com/v1beta/models?key=" +
    encodeURIComponent(String(apiKey));

  const modelPreference = [
    "models/gemini-1.5-flash",
    "models/gemini-1.5-pro",
    "models/gemini-1.0-pro",
  ];

  let models: any[] = [];
  let listModelsErrorText = "";
  try {
    const listResp = await fetch(listUrl);
    if (!listResp.ok) {
      listModelsErrorText = await listResp.text();
    } else {
      const listJson: any = await listResp.json();
      models = Array.isArray(listJson?.models) ? listJson.models : [];
    }
  } catch (e: any) {
    listModelsErrorText = e?.message ? String(e.message) : String(e);
  }

  const supported = models.filter((m) =>
    m &&
    typeof m === "object" &&
    typeof m.name === "string" &&
    Array.isArray(m.supportedGenerationMethods) &&
    m.supportedGenerationMethods.includes("generateContent")
  );

  const supportedNames = supported.map((m) => String(m.name));
  const preferredSupported = modelPreference.filter((pref) => supportedNames.includes(pref));
  const otherSupported = supportedNames.filter((name) => !preferredSupported.includes(name));
  const modelCandidates = [...preferredSupported, ...otherSupported];

  if (modelCandidates.length === 0) {
    throw new HttpsError(
      "failed-precondition",
      `No Gemini model with generateContent is available for this API key. ListModels error: ${listModelsErrorText || "(none)"}`
    );
  }

  const callGemini = async (modelName: string) => {
    const genUrl =
      `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=` +
      encodeURIComponent(String(apiKey));

    return fetch(genUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7 },
      }),
    });
  };

  let lastErrText = "";
  let lastStatus: number | undefined;
  let json: any = null;

  for (const modelName of modelCandidates) {
    const resp = await callGemini(modelName);

    if (resp.ok) {
      json = await resp.json();
      break;
    }

    lastStatus = resp.status;
    lastErrText = await resp.text();

    if (resp.status === 429) {
      throw new HttpsError(
        "resource-exhausted",
        `Gemini quota/rate limit exceeded. Please wait and try again, or check your Gemini API quota/billing. Details: ${lastErrText}`
      );
    }

    const errLower = String(lastErrText || "").toLowerCase();
    const isModelNotFound =
      resp.status === 404 ||
      errLower.includes("model not found") ||
      errLower.includes("is no longer available") ||
      errLower.includes("not_found");

    if (isModelNotFound) {
      continue;
    }

    throw new HttpsError("internal", `Gemini API error: ${lastErrText}`);
  }

  if (!json) {
    throw new HttpsError(
      "failed-precondition",
      `No supported Gemini model succeeded. Last status: ${String(lastStatus ?? "(unknown)")}. Details: ${lastErrText}`
    );
  }

  const textOut = String(json?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
  if (!textOut) {
    return { questions: [] };
  }

  try {
    const extractJsonCandidate = (s: string): string => {
      const trimmed = String(s || "").trim();

      const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (fenceMatch && fenceMatch[1]) return String(fenceMatch[1]).trim();

      const firstBrace = trimmed.indexOf("{");
      const lastBrace = trimmed.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        return trimmed.slice(firstBrace, lastBrace + 1).trim();
      }

      return trimmed;
    };

    const parsed = JSON.parse(extractJsonCandidate(textOut));
    if (mode === "mcq") {
      const items = Array.isArray(parsed?.questions) ? parsed.questions : [];
      const questions = items
        .map((it: any) => {
          const question = String(it?.question || "").trim();
          const choices = it?.choices && typeof it.choices === "object" ? it.choices : {};
          const A = String(choices?.A || "").trim();
          const B = String(choices?.B || "").trim();
          const C = String(choices?.C || "").trim();
          const D = String(choices?.D || "").trim();
          const answer = String(it?.answer || "").trim().toUpperCase();

          if (!question || !A || !B || !C || !D) return null;
          if (!["A", "B", "C", "D"].includes(answer)) return null;
          return { question, choices: { A, B, C, D }, answer };
        })
        .filter(Boolean);

      return { questions };
    }

    const questions = Array.isArray(parsed?.questions) ? parsed.questions.map((q: any) => String(q)) : [];
    return { questions };
  } catch {
    // If Gemini didn't return valid JSON, return the raw text so the client can display it.
    return { questions: [textOut] };
  }

});
