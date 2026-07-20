import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ConvinicarService {
  private readonly logger = new Logger(ConvinicarService.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    this.apiUrl = 'https://qhvsmufpwgxyufxdrykp.supabase.co/functions/v1/integration-api';
    this.apiKey = this.configService.get<string>('CONVINICAR_INTEGRATION_API_KEY') || '';
  }

  private async fetchFromApi<T>(action: string, params: any = {}): Promise<T> {
    if (!this.apiKey) {
      this.logger.warn('CONVINICAR_INTEGRATION_API_KEY is not configured in environment variables');
      throw new Error('CONVINICAR_INTEGRATION_API_KEY is missing');
    }

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({ action, params }),
      });

      if (!response.ok) {
        throw new Error(`Convinicar API returned ${response.status}: ${await response.text()}`);
      }

      return await response.json();
    } catch (error) {
      this.logger.error(`Failed to call Convinicar API for action ${action}`, error);
      throw error;
    }
  }

  /**
   * Pings the API to check if it's alive and our API key works.
   */
  async ping() {
    return this.fetchFromApi('ping');
  }

  /**
   * Fetches service requests from Convinicar.
   */
  async listServiceRequests(status: string = 'pending', limit: number = 20) {
    return this.fetchFromApi('list_service_requests', { status, limit });
  }

  /**
   * Updates a service request in Convinicar (e.g., to say a driver is enroute).
   */
  async updateServiceRequest(id: string, updates: any) {
    return this.fetchFromApi('update_service_request', { id, ...updates });
  }

  /**
   * Responds to a Convinicar tow_offer (accept or decline).
   * Uses the x-internal-key header with the Convinicar Supabase service role key,
   * matching the same bypass pattern used by dispatch-tow internally.
   */
  async respondToOffer(offerId: string, action: 'accept' | 'decline') {
    const url = this.apiUrl.replace('/integration-api', '/respond-tow-offer');
    
    // This must be Convinicar's SUPABASE_SERVICE_ROLE_KEY — not the integration API key.
    const serviceRoleKey = this.configService.get<string>('CONVINICAR_SERVICE_ROLE_KEY') || '';
    if (!serviceRoleKey) {
      this.logger.warn('CONVINICAR_SERVICE_ROLE_KEY is not configured — cannot respond to offers');
      throw new Error('CONVINICAR_SERVICE_ROLE_KEY is missing');
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`,
          'x-internal-key': serviceRoleKey,
        },
        body: JSON.stringify({ offer_id: offerId, action }),
      });

      if (!response.ok) {
        throw new Error(`Convinicar respond-tow-offer returned ${response.status}: ${await response.text()}`);
      }

      return await response.json();
    } catch (error) {
      this.logger.error(`Failed to respond to Convinicar offer ${offerId}`, error);
      throw error;
    }
  }
}
