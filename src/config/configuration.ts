export default () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '30d',
  },
  redis: { url: process.env.REDIS_URL },
  gemini: { apiKey: process.env.GEMINI_API_KEY },
})
