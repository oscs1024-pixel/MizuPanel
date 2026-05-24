package metrics

import (
	stdnet "net"
	"runtime"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	netio "github.com/shirou/gopsutil/v4/net"
)

type Collector struct {
	previousNet   *netio.IOCountersStat
	previousNetAt time.Time
}

func NewCollector() *Collector {
	return &Collector{}
}

func (c *Collector) Collect() (Snapshot, error) {
	hostInfo, err := host.Info()
	if err != nil {
		return Snapshot{}, err
	}
	cpuUsage, err := cpu.Percent(0, false)
	if err != nil {
		return Snapshot{}, err
	}
	cpuCounts, err := cpu.Counts(true)
	if err != nil {
		return Snapshot{}, err
	}
	memory, err := mem.VirtualMemory()
	if err != nil {
		return Snapshot{}, err
	}
	rootDisk, err := disk.Usage("/")
	if err != nil {
		return Snapshot{}, err
	}
	ioCounters, err := netio.IOCounters(false)
	if err != nil {
		return Snapshot{}, err
	}
	loadInfo, err := load.Avg()
	if err != nil {
		return Snapshot{}, err
	}

	var rxTotal, txTotal, rxSpeed, txSpeed int64
	if len(ioCounters) > 0 {
		current := ioCounters[0]
		now := time.Now()
		rxTotal = int64(current.BytesRecv)
		txTotal = int64(current.BytesSent)
		if c.previousNet != nil {
			rxSpeed = bytesPerSecond(c.previousNet.BytesRecv, current.BytesRecv, c.previousNetAt, now)
			txSpeed = bytesPerSecond(c.previousNet.BytesSent, current.BytesSent, c.previousNetAt, now)
		}
		c.previousNet = &current
		c.previousNetAt = now
	}

	usage := 0.0
	if len(cpuUsage) > 0 {
		usage = cpuUsage[0]
	}
	return Snapshot{
		Hostname:    hostInfo.Hostname,
		IP:          localIP(),
		OS:          runtime.GOOS,
		Arch:        runtime.GOARCH,
		Kernel:      hostInfo.KernelVersion,
		Uptime:      int64(hostInfo.Uptime),
		CPUCores:    cpuCounts,
		CPUUsage:    usage,
		MemoryTotal: int64(memory.Total),
		MemoryUsed:  int64(memory.Used),
		MemoryUsage: usagePercent(memory.Total, memory.Used),
		DiskTotal:   int64(rootDisk.Total),
		DiskUsed:    int64(rootDisk.Used),
		DiskUsage:   usagePercent(rootDisk.Total, rootDisk.Used),
		RXSpeed:     rxSpeed,
		TXSpeed:     txSpeed,
		RXTotal:     rxTotal,
		TXTotal:     txTotal,
		Load1:       loadInfo.Load1,
		Load5:       loadInfo.Load5,
		Load15:      loadInfo.Load15,
	}, nil
}

func usagePercent(total uint64, used uint64) float64 {
	if total == 0 {
		return 0
	}
	return float64(used) / float64(total) * 100
}

func localIP() string {
	interfaces, err := stdnet.Interfaces()
	if err != nil {
		return ""
	}
	var addresses []stdnet.IP
	for _, networkInterface := range interfaces {
		if networkInterface.Flags&stdnet.FlagUp == 0 || networkInterface.Flags&stdnet.FlagLoopback != 0 {
			continue
		}
		interfaceAddresses, err := networkInterface.Addrs()
		if err != nil {
			continue
		}
		for _, address := range interfaceAddresses {
			ip, _, err := stdnet.ParseCIDR(address.String())
			if err == nil && ip != nil {
				addresses = append(addresses, ip)
			}
		}
	}
	return chooseLocalIP(addresses)
}

func chooseLocalIP(addresses []stdnet.IP) string {
	fallback := ""
	for _, ip := range addresses {
		if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() || !ip.IsGlobalUnicast() {
			continue
		}
		if ipv4 := ip.To4(); ipv4 != nil {
			return ipv4.String()
		}
		if fallback == "" {
			fallback = ip.String()
		}
	}
	return fallback
}

func bytesPerSecond(previous uint64, current uint64, previousAt time.Time, currentAt time.Time) int64 {
	elapsed := currentAt.Sub(previousAt).Seconds()
	if elapsed <= 0 || current < previous {
		return 0
	}
	return int64(float64(current-previous) / elapsed)
}
