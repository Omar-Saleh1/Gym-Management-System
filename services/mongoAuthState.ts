import { proto, AuthenticationCreds, AuthenticationState, SignalDataTypeMap, initAuthCreds, BufferJSON } from '@whiskeysockets/baileys';
import mongoose from 'mongoose';

const AuthSchema = new mongoose.Schema({
  sessionId: { type: String, required: true },
  key: { type: String, required: true },
  value: { type: String, required: true }
});
AuthSchema.index({ sessionId: 1, key: 1 }, { unique: true });

export const AuthModel = mongoose.models.WhatsAppAuth || mongoose.model('WhatsAppAuth', AuthSchema);

export const useMongoDBAuthState = async (sessionId: string) => {
  const writeData = async (data: any, key: string) => {
    const value = JSON.stringify(data, BufferJSON.replacer);
    await AuthModel.updateOne(
      { sessionId, key },
      { value },
      { upsert: true }
    );
  };

  const readData = async (key: string) => {
    const doc = await AuthModel.findOne({ sessionId, key });
    if (doc && doc.value) {
      return JSON.parse(doc.value, BufferJSON.reviver);
    }
    return null;
  };

  const removeData = async (key: string) => {
    await AuthModel.deleteOne({ sessionId, key });
  };

  const creds: AuthenticationCreds = (await readData('creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type: keyof SignalDataTypeMap, ids: string[]) => {
          const data: { [id: string]: any } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data: any) => {
          const tasks: Promise<void>[] = [];
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category as keyof typeof data][id];
              const key = `${category}-${id}`;
              tasks.push(value ? writeData(value, key) : removeData(key));
            }
          }
          await Promise.all(tasks);
        }
      }
    } as AuthenticationState,
    saveCreds: () => writeData(creds, 'creds')
  };
};
