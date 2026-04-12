import { Client, Account, Databases, Storage } from 'appwrite';

const client = new Client();

const endpoint = import.meta.env.VITE_APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1';
const projectId = import.meta.env.VITE_APPWRITE_PROJECT_ID;

if (!projectId) {
  console.warn('Appwrite Project ID is missing. Please set VITE_APPWRITE_PROJECT_ID in your environment.');
}

client
    .setEndpoint(endpoint)
    .setProject(projectId || '');

export const account = new Account(client);
export const databases = new Databases(client);
export const storage = new Storage(client);
export { client };

export const APPWRITE_CONFIG = {
    databaseId: import.meta.env.VITE_APPWRITE_DATABASE_ID || '',
    itemsCollectionId: import.meta.env.VITE_APPWRITE_ITEMS_COLLECTION_ID || '',
    usersCollectionId: import.meta.env.VITE_APPWRITE_USERS_COLLECTION_ID || '',
};
