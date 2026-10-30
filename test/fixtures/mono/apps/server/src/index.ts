import express from "express";
import { router } from "@mono/api";
import { gone } from "@mono/ui/missing";

express().use(router, gone);
