import assert from "node:assert/strict";
import test from "node:test";
import { evaluationSchema } from "../src/jev.js";

test("accepts a valid Chinese Noul request", () => {
  const value = evaluationSchema.parse({
    type: "noul",
    state: "客户表示今天必须解决问题。",
    instructions: "这个请求是否紧急？",
  });
  assert.equal(value.type, "noul");
});

test("rejects duplicate Choice labels", () => {
  const result = evaluationSchema.safeParse({
    type: "choice",
    state: "测试内容",
    instructions: "应该选择哪个？",
    options: [
      { label: "相同", description: "第一项" },
      { label: "相同", description: "第二项" },
    ],
  });
  assert.equal(result.success, false);
});

test("requires ordered Score levels", () => {
  const result = evaluationSchema.safeParse({
    type: "score",
    state: "测试内容",
    instructions: "风险有多高？",
    levels: ["低"],
  });
  assert.equal(result.success, false);
});
