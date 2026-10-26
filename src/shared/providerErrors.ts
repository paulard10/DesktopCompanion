/** Fixed user-facing provider failures. Imports nothing. */

export type ProviderFailureCode =
  | 'connection-timeout'
  | 'timeout'
  | 'cancelled'
  | 'unavailable'
  | 'authentication'
  | 'rate-limit'
  | 'quota'
  | 'invalid'
  | 'malformed'
  | 'missing-key'
  | 'missing-endpoint'
  | 'encryption-unavailable'
  | 'busy'
  | 'rejected';

export function providerFailureMessage(code: string): string {
  switch (code) {
    case 'connection-timeout':
      return 'Model Studio did not start the reply in time. Nothing was retried.';
    case 'timeout':
      return 'The reply took too long and was stopped. Nothing was retried.';
    case 'cancelled':
      return 'Stopped.';
    case 'unavailable':
      return 'The network call failed. Demo mode still works offline. Nothing was retried.';
    case 'authentication':
      return 'Model Studio rejected the API key. Remove it and save the Singapore key again.';
    case 'rate-limit':
      return 'Model Studio is rate-limiting requests. Wait, then send once. This app will not retry.';
    case 'quota':
      return 'The free quota or account quota blocked this call. This app will not switch models or retry.';
    case 'invalid':
      return 'Model Studio rejected the request. The model stays qwen3.7-plus. Nothing was retried.';
    case 'malformed':
      return 'The provider sent a response this app could not read. Nothing was retried.';
    case 'missing-key':
      return 'Save a Model Studio API key in Connection. The key stays on this PC.';
    case 'missing-endpoint':
      return 'Add the Singapore workspace endpoint from the Model Studio console. It must end in ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1.';
    case 'encryption-unavailable':
      return 'Windows secure storage is unavailable, so the key was not saved.';
    case 'busy':
      return 'A reply is already in progress.';
    case 'rejected':
      return 'That value was not saved.';
    default:
      return 'The request stopped. Nothing was retried.';
  }
}

export function classifyProviderHttp(status: number, body: string): ProviderFailureCode {
  const text = body.toLowerCase();
  if (status === 401 || text.includes('invalid_api_key') || text.includes('incorrect api key')) {
    return 'authentication';
  }
  if (status === 429 && (text.includes('quota') || text.includes('billing') || text.includes('arrears'))) {
    return 'quota';
  }
  if (status === 429) {
    return 'rate-limit';
  }
  if (status === 400) {
    return 'invalid';
  }
  if (status === 408 || status === 504) {
    return 'timeout';
  }
  if (status === 500 || status === 503) {
    return 'unavailable';
  }
  return 'unavailable';
}
