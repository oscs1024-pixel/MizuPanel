package retention

import (
	"context"
	"time"

	"github.com/mizupanel/mizupanel/internal/server/store"
)

type Cleaner struct {
	metrics           *store.MetricStore
	retentionProvider func() (time.Duration, error)
}

func NewCleaner(metrics *store.MetricStore, retention time.Duration) *Cleaner {
	return NewDynamicCleaner(metrics, func() (time.Duration, error) { return retention, nil })
}

func NewDynamicCleaner(metrics *store.MetricStore, retentionProvider func() (time.Duration, error)) *Cleaner {
	return &Cleaner{metrics: metrics, retentionProvider: retentionProvider}
}

func (c *Cleaner) RunOnce(ctx context.Context, now time.Time) (int64, error) {
	retention, err := c.retentionProvider()
	if err != nil {
		return 0, err
	}
	return c.metrics.DeleteOlderThan(ctx, now.Add(-retention))
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
