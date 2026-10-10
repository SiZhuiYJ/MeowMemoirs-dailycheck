// @/libs/http/index.ts
import Http from "./axios";
import { API_BASE_URL } from "@/config/index";
import type { AxiosRequestConfig } from "axios";

const defaultConfig: AxiosRequestConfig = {
  baseURL: API_BASE_URL,
  timeout: 120000,
};

const http = new Http(defaultConfig);

export default http;
