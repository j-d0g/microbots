"use client";

import { answerTask, command, createTask, deleteTask, patchTask, reset } from "./api";

export const actions = { command, createTask, patchTask, deleteTask, answer: answerTask, reset };
