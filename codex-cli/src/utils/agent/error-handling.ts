// Error handling utilities for the agent loop
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions.mjs";
import OpenAI, { APIConnectionTimeoutError } from "openai";

/**
 * Determines if an error is a timeout error
 */
export function isErrorTimeout(error: any): boolean {
  return error instanceof APIConnectionTimeoutError;
}

/**
 * Determines if an error is a connection error
 */
export function isErrorConnectionError(error: any): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ApiConnErrCtor = (OpenAI as any).APIConnectionError as 
    | (new (...args: any) => Error)
    | undefined;
  return ApiConnErrCtor ? error instanceof ApiConnErrCtor : false;
}

/**
 * Gets the HTTP status code from an error
 */
export function getErrorStatusCode(error: any): number | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errCtx = error as any;
  return errCtx?.status ?? errCtx?.httpStatus ?? errCtx?.statusCode;
}

/**
 * Determines if an error is a server error (5xx)
 */
export function isErrorServerError(error: any): boolean {
  const status = getErrorStatusCode(error);
  return typeof status === "number" && status >= 500;
}

/**
 * Determines if an error is a rate limit error
 */
export function isErrorRateLimit(error: any): boolean {
  const status = getErrorStatusCode(error);
  const isRateLimit = 
    status === 429 ||
    (error as any).code === "rate_limit_exceeded" ||
    (error as any).type === "rate_limit_exceeded" ||
    /rate limit/i.test((error as any).message ?? "");
  return isRateLimit;
}

/**
 * Determines if an error is a client error (4xx)
 */
export function isErrorClientError(error: any): boolean {
  const status = getErrorStatusCode(error);
  const isClientError = 
    (typeof status === "number" &&
      status >= 400 &&
      status < 500 &&
      status !== 429) ||
    (error as any).code === "invalid_request_error" ||
    (error as any).type === "invalid_request_error";
  return isClientError;
}

/**
 * Determines if an error is a token limit error
 */
export function isErrorTooManyTokens(error: any): boolean {
  const errCtx = error as any;
  const isTooManyTokensError = 
    (errCtx.param === "max_tokens" ||
      (typeof errCtx.message === "string" &&
        /max_tokens is too large/i.test(errCtx.message))) &&
    errCtx.type === "invalid_request_error";
  return isTooManyTokensError;
}

/**
 * Determines if an error is an insufficient quota error
 */
export function isErrorInsufficientQuota(error: any): boolean {
  return (error as { code?: string }).code === "insufficient_quota";
}

/**
 * Determines if an error is a premature close error
 */
export function isErrorPrematureClose(error: any): boolean {
  return error instanceof Error && 
    // eslint-disable-next-line
    ((error as any).code === "ERR_STREAM_PREMATURE_CLOSE" ||
      error.message?.includes("Premature close"));
}

/**
 * Determines if an error is a network or server error
 */
export function isErrorNetworkOrServer(error: any): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e: any = error;

  // Direct instance check for connection errors thrown by the OpenAI SDK.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ApiConnErrCtor = (OpenAI as any).APIConnectionError as 
    | (new (...args: any) => Error)
    | undefined;
  if (ApiConnErrCtor && e instanceof ApiConnErrCtor) {
    return true;
  }

  const NETWORK_ERRNOS = new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "EPIPE",
    "ENOTFOUND",
    "ETIMEDOUT",
    "EAI_AGAIN",
  ]);

  if (typeof e.code === "string" && NETWORK_ERRNOS.has(e.code)) {
    return true;
  }

  // When the OpenAI SDK nests the underlying network failure inside the
  // `cause` property we surface it as well so callers do not see an
  // unhandled exception for errors like ENOTFOUND, ECONNRESET …
  if (
    e.cause &&
    typeof e.cause === "object" &&
    NETWORK_ERRNOS.has((e.cause as { code?: string }).code ?? "")
  ) {
    return true;
  }

  if (typeof e.status === "number" && e.status >= 500) {
    return true;
  }

  // Fallback to a heuristic string match so we still catch future SDK
  // variations without enumerating every errno.
  if (
    typeof e.message === "string" &&
    /network|socket|stream/i.test(e.message)
  ) {
    return true;
  }

  return false;
}

/**
 * Creates a system message for network errors
 */
export function createNetworkErrorSystemMessage(provider: string = "AI"): ChatCompletionMessageParam {
  return {
    role: "assistant",
    content: [
      {
        type: "text",
        text: `⚠️  Network error while contacting ${provider}. Please check your connection and try again.`,
      },
    ],
  };
}

/**
 * Creates a system message for rate limit errors
 */
export function createRateLimitErrorSystemMessage(): ChatCompletionMessageParam {
  return {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "⚠️  Rate limit reached. Please try again later.",
      },
    ],
  };
}

/**
 * Creates a system message for token limit errors
 */
export function createTokenLimitErrorSystemMessage(): ChatCompletionMessageParam {
  return {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "⚠️  The current request exceeds the maximum context length supported by the chosen model. Please shorten the conversation, run /clear, or switch to a model with a larger context window and try again.",
      },
    ],
  };
}

/**
 * Creates a system message for invalid request errors
 */
export function createInvalidRequestErrorSystemMessage(error: any, provider: string = "AI"): ChatCompletionMessageParam {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e: any = error;

  const reqId =
    e.request_id ??
    (e.cause && e.cause.request_id) ??
    (e.cause && e.cause.requestId);

  const errorDetails = [
    `Status: ${e.status || (e.cause && e.cause.status) || "unknown"}`,
    `Code: ${e.code || (e.cause && e.cause.code) || "unknown"}`,
    `Type: ${e.type || (e.cause && e.cause.type) || "unknown"}`,
    `Message: ${e.message || (e.cause && e.cause.message) || "unknown"}`,
  ].join(", ");

  const msgText = `⚠️  ${provider} rejected the request${
    reqId ? ` (request ID: ${reqId})` : ""
  }. Error details: ${errorDetails}. Please verify your settings and try again.`;

  return {
    role: "assistant",
    content: [
      {
        type: "text",
        text: msgText,
      },
    ],
  };
}