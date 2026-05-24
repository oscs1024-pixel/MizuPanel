package retention

import (
	"context"
	"time"

	"github.com/mizupanel/mizupanel/internal/server/store"
)

type Cleaner struct {
	metrics   *store.MetricStore
	retention time.Duration
}

func NewCleaner(metrics *store.MetricStore, retention time.Duration) *Cleaner {
	return &Cleaner{metrics: metrics, retention: retention}
}

func (c *Cleaner) RunOnce(ctx context.Context, now time.Time) (int64, error) {
	return c.metrics.DeleteOlderThan(ctx, now.Add(-c.retention))
}

func (c *Cleaner) Run(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			_, _ = c.RunOnce(ctx, now.UTC())
		}
	}
}
