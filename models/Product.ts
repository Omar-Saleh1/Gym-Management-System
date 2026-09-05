import mongoose, { Schema, Document } from 'mongoose';

export const PRODUCT_CATEGORIES = [
  'ملابس رياضية',
  'كرياتين',
  'بروتين',
  'بروتين بار',
  'شيك بروتين',
  'شيكر',
  'سبلمينت',
  'عام',
] as const;

export type ProductCategory = typeof PRODUCT_CATEGORIES[number];

export interface IProduct extends Document {
  name: string;
  category: ProductCategory;
  price: number;
  costPrice: number;
  stock: number;
  image?: string;
  barcode?: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new Schema<IProduct>(
  {
    name:      { type: String, required: true },
    category:  { type: String, enum: PRODUCT_CATEGORIES, default: 'عام' },
    price:     { type: Number, required: true },
    costPrice: { type: Number, default: 0 },
    stock:     { type: Number, default: 0 },
    image:     { type: String, default: '' },
    barcode:   { type: String },
    active:    { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model<IProduct>('Product', productSchema);

