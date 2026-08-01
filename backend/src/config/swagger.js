import swaggerJsdoc from 'swagger-jsdoc';
import { CAMPAIGN_TYPE_IDS, DEFAULT_CAMPAIGN_TYPE } from '../utils/campaignTypes.js';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'MKTR Platform API',
      version: '1.0.0',
      description: 'Marketing platform API for campaigns, prospects, fleet management, and agent operations.',
    },
    servers: [
      { url: '/api', description: 'API base path' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        // Derived from the campaign-type registry — route docs $ref this
        // instead of restating the enum.
        CampaignType: {
          type: 'string',
          enum: CAMPAIGN_TYPE_IDS,
          default: DEFAULT_CAMPAIGN_TYPE,
        },
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string' },
          },
        },
        Pagination: {
          type: 'object',
          properties: {
            total: { type: 'integer' },
            page: { type: 'integer' },
            limit: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/*.js'],
};

export const swaggerSpec = swaggerJsdoc(options);
