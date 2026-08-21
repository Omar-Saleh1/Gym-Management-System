import mongoose, { Schema, Document } from 'mongoose';
import { IProduct } from './Product';
import { IMember } from './Member';
import { ICashier } from './Cashier';

export interface ISaleItem {
  product: mongoose.Types.ObjectId | IProduct;
  name: string;
  price: number;
  quantity: number;
}

export interface ISale extends Document {
  items: ISaleItem[];
  total: number;
  paymentMethod: string;
  notes?: string;
  member?: mongoose.Types.ObjectId | IMember;
  cashier: mongoose.Types.ObjectId | ICashier;
  createdAt: Date;
  updatedAt: Date;
}

const saleItemSchema = new Schema<ISaleItem>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    quantity: { type: Number, required: true },
  },
  { _id: false }
);

const saleSchema = new Schema<ISale>(
  {
    items: [saleItemSchema],
    total: { type: Number, required: true },
    paymentMethod: { type: String, default: 'cash' },
    notes: { type: String, default: '' },
    member: { type: Schema.Types.ObjectId, ref: 'Member' },
    cashier: { type: Schema.Types.ObjectId, ref: 'Cashier', required: true },
  },
  { timestamps: true }
);

export default mongoose.model<ISale>('Sale', saleSchema);
