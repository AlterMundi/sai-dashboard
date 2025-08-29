import winston from 'winston';
import { appConfig } from '@/config';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  appConfig.logging.format === 'json' 
    ? winston.format.json()
    : winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        const stackStr = stack ? `\n${stack}` : '';
        return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}${stackStr}`;
      })
);

const transports: winston.transport[] = [
  new winston.transports.Console({
    level: appConfig.logging.level,
    format: logFormat,
    handleExceptions: true,
    handleRejections: true,
  })
];

if (appConfig.logging.filePath) {
  transports.push(
    new winston.transports.File({
      filename: appConfig.logging.filePath,
      level: appConfig.logging.level,
      format: logFormat,
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      handleExceptions: true,
      handleRejections: true,
    })
  );
}

export const logger = winston.createLogger({
  level: appConfig.logging.level,
  format: logFormat,
  transports,
  exitOnError: false,
});

export const expressLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, message }) => `${timestamp} [HTTP] ${message}`)
  ),
  transports: [new winston.transports.Console()]
});