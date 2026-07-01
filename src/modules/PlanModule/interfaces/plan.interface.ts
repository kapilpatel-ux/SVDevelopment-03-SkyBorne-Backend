import { Document } from "mongoose";

export interface IServiceClassCount {
  service: string;
  classCountPerMonth: number;
}

export interface IPlan {
  name: string;
  description?: string;
  features: string[];
  services: string[];
  serviceClassCounts: IServiceClassCount[];
  classCountPerMonth: number;
  image: string;
  price: number;
  isActive: boolean;
  order: number;
  uuid: string;
}

export interface IPlanDocument extends IPlan, Document {}
