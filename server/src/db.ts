import { PrismaClient } from "@prisma/client";
import "./env";

export const prisma = new PrismaClient();
