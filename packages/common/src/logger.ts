import pino from 'pino';
import type { Logger, LoggerOptions } from 'pino';

type CreateLoggerOptions = LoggerOptions & {name: string}


export const createLogger = (options: CreateLoggerOptions): Logger => {
    const { name, ...loggerOptions } = options;
    const transport = process.env.NODE_ENV === 'development' ? {
        target:'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'yyyy-mm-dd HH:MM:ss.l o',
        },
    }:undefined


    return pino({
        ...loggerOptions,
        name,
        transport,
        level: process.env.LOG_LEVEL || 'info',
    });
}