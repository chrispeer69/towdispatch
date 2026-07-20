'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { JobDto } from '@ustowdispatch/shared';
import { toast } from 'sonner';

/**
 * A loud, Towbook-style modal that pops up whenever a new Convinicar offer arrives.
 * This listens for state changes in the parent board context, or accepts a direct prop.
 */
export function ConvinicarAlarmModal({
  job,
  onClose,
  onHandled,
}: {
  job: JobDto | null;
  onClose: () => void;
  onHandled?: () => void;
}) {
  const [loading, setLoading] = useState(false);

  // Play a loud ringing noise using Web Audio API when modal opens
  useEffect(() => {
    if (job) {
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        
        // Create a simple repeated beeping alarm sound
        const playBeep = (time: number) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          
          osc.type = 'square';
          osc.frequency.setValueAtTime(800, time);
          osc.frequency.setValueAtTime(1200, time + 0.1);
          
          gain.gain.setValueAtTime(0.5, time);
          gain.gain.exponentialRampToValueAtTime(0.01, time + 0.4);
          
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          
          osc.start(time);
          osc.stop(time + 0.4);
        };

        // Play 5 beeps
        for (let i = 0; i < 5; i++) {
          playBeep(audioCtx.currentTime + i * 0.5);
        }
      } catch (e) {
        console.error("Audio API error:", e);
      }
    }
  }, [job]);

  if (!job) return null;

  const handleAction = async (action: 'accept' | 'reject') => {
    if (!job.convinicarOfferId) {
      toast.error('Missing Convinicar Offer ID');
      return;
    }
    
    setLoading(true);
    try {
      const res = await fetch(`/api/integrations/convinicar/${job.id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offerId: job.convinicarOfferId }),
      });
      
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Failed to ${action} offer`);
      }
      
      toast.success(`Successfully ${action}ed Convinicar offer!`);
      onHandled?.();
      onClose();
    } catch (e: any) {
      toast.error(e.message || `Error ${action}ing offer`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={!!job} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl border-brand-primary ring-4 ring-brand-primary/50 shadow-2xl bg-bg-surface">
        <DialogHeader>
          <DialogTitle className="text-3xl font-extrabold uppercase tracking-wide text-brand-primary flex items-center gap-3">
            <span className="animate-pulse">🚨 NEW CONVINICAR OFFER 🚨</span>
          </DialogTitle>
          <DialogDescription className="text-lg text-text-primary-on-dark pt-4 font-mono">
            A new roadside assistance request has been routed to your queue!
          </DialogDescription>
        </DialogHeader>

        <div className="py-6 space-y-4">
          <div className="bg-bg-base rounded-md p-4 border border-divider">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-text-secondary-on-dark uppercase text-[10px] font-bold tracking-widest">Service Type</p>
                <p className="font-bold text-lg">{job.serviceType.replace('_', ' ').toUpperCase()}</p>
              </div>
              <div>
                <p className="text-text-secondary-on-dark uppercase text-[10px] font-bold tracking-widest">Job Number</p>
                <p className="font-mono text-lg">#{job.jobNumber}</p>
              </div>
              <div className="col-span-2 mt-2">
                <p className="text-text-secondary-on-dark uppercase text-[10px] font-bold tracking-widest">Pickup Location</p>
                <p className="text-lg font-medium">{job.pickupAddress}</p>
              </div>
              {job.dropoffAddress && (
                <div className="col-span-2">
                  <p className="text-text-secondary-on-dark uppercase text-[10px] font-bold tracking-widest">Dropoff Location</p>
                  <p className="text-lg font-medium">{job.dropoffAddress}</p>
                </div>
              )}
            </div>
          </div>
          <p className="text-center text-accent-orange font-bold animate-pulse">
            You have 2 minutes to respond before this offer expires!
          </p>
        </div>

        <DialogFooter className="flex gap-4 sm:justify-center">
          <Button 
            variant="destructive" 
            size="lg" 
            className="w-48 text-xl py-8 font-black uppercase tracking-widest"
            onClick={() => handleAction('reject')}
            disabled={loading}
          >
            Decline
          </Button>
          <Button 
            variant="default" 
            size="lg" 
            className="w-48 text-xl py-8 font-black uppercase tracking-widest bg-ok hover:bg-ok/80 text-white"
            onClick={() => handleAction('accept')}
            disabled={loading}
          >
            Accept
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
