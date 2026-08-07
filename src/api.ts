import axios, { AxiosInstance } from 'axios';
import { SalesRecordPayload, StorePayload } from './types';

let httpClient: AxiosInstance | null = null;

function getHttpClient(): AxiosInstance {
  if (httpClient) return httpClient;

  const baseURL = process.env.API_BASE_URL;
  const token = process.env.API_TOKEN;

  if (!baseURL) {
    throw new Error('API_BASE_URL is not set. Add it to your .env file (see .env.example).');
  }

  httpClient = axios.create({
    baseURL,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });

  return httpClient;
}

/** Upserts the store this row belongs to before the sales record is written. */
export async function createOrUpdateStore(payload: StorePayload): Promise<void> {
  // TODO: replace with the real endpoint for creating/updating a store.
  await getHttpClient().post('/TODO-store-endpoint', payload);
}

/** Sends one parsed sales report row to the backend. */
export async function importSalesRecord(payload: SalesRecordPayload): Promise<void> {
  // TODO: replace with the real endpoint for importing a sales record.
  await getHttpClient().post('/TODO-sales-import-endpoint', payload);
}
