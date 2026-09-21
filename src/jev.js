import { z } from "zod";
import { config } from "./config.js";

const base = {
  state: z.string().trim().min(1, "请填写待判断内容").max(config.maxStateLength, "内容过长"),
  instructions: z.string().trim().min(3, "问题至少需要 3 个字").max(500, "问题过长"),
};

const optionSchema = z.object({
  label: z.string().trim().min(1, "选项不能为空").max(80, "选项名称过长"),
  description: z.string().trim().max(240, "选项说明过长").optional().default(""),
});

export const evaluationSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("noul") }),
  z.object({
    ...base,
    type: z.literal("choice"),
    options: z.array(optionSchema).min(2, "至少需要两个选项").max(6, "最多六个选项"),
  }).superRefine((value, context) => {
    const labels = value.options.map((option) => option.label.toLowerCase());
    if (new Set(labels).size !== labels.length) {
      context.addIssue({ code: "custom", message: "选项名称不能重复", path: ["options"] });
    }
  }),
  z.object({
    ...base,
    type: z.literal("score"),
    levels: z.array(z.string().trim().min(1, "等级不能为空").max(160, "等级描述过长"))
      .min(2, "至少需要两个等级")
      .max(6, "最多六个等级"),
  }),
]);

function buildQuestion(input) {
  if (input.type === "noul") {
    return { type: "noul", instructions: input.instructions };
  }
  if (input.type === "choice") {
    const criteria = {};
    const labels = {};
    input.options.forEach((option, index) => {
      const key = `option_${index + 1}`;
      labels[key] = option.label;
      criteria[key] = option.description || option.label;
    });
    return {
      question: { type: "choice", instructions: input.instructions, criteria },
      labels,
    };
  }
  return {
    type: "score",
    instructions: input.instructions,
    criteria: input.levels,
  };
}

function normalizeAnswer(input, answer, model, usage) {
  if (input.type === "noul") {
    return {
      type: "noul",
      probability: answer.noul,
      model,
      usage,
    };
  }

  if (input.type === "choice") {
    const built = buildQuestion(input);
    const probabilities = Object.fromEntries(
      Object.entries(answer.probabilities || {}).map(([key, probability]) => [
        built.labels[key] || key,
        probability,
      ]),
    );
    return {
      type: "choice",
      choice: built.labels[answer.choice] || answer.choice,
      confidence: answer.confidence,
      probabilities,
      model,
      usage,
    };
  }

  const probabilities = Object.fromEntries(
    Object.entries(answer.probabilities || {}).map(([key, probability]) => [
      input.levels[Number(key)] || key,
      probability,
    ]),
  );
  return {
    type: "score",
    score: answer.score,
    maxScore: input.levels.length - 1,
    confidence: answer.confidence,
    levels: input.levels,
    probabilities,
    model,
    usage,
  };
}

export async function evaluateWithJev(input) {
  if (!config.typeSafeApiKey) {
    const error = new Error("Jev 服务尚未配置完成");
    error.code = "JEV_NOT_CONFIGURED";
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const built = buildQuestion(input);
    const question = input.type === "choice" ? built.question : built;
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.typeSafeApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "jev-latest",
        state: input.state,
        questions: { decision: question },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const error = new Error(`TypeSafe request failed with ${response.status}`);
      error.code = [429, 529].includes(response.status) ? "JEV_RATE_LIMIT" : "JEV_UPSTREAM_ERROR";
      throw error;
    }

    const data = await response.json();
    const answer = data?.answers?.decision;
    if (!answer) {
      const error = new Error("TypeSafe response did not include an answer");
      error.code = "JEV_INVALID_RESPONSE";
      throw error;
    }
    return normalizeAnswer(input, answer, data.model, data.usage);
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("Jev 请求超时，请稍后再试");
      timeoutError.code = "JEV_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
