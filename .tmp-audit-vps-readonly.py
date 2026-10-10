import paramiko,pathlib,json
c=paramiko.SSHClient();c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("179.236.250.51",username="root",key_filename=str(pathlib.Path.home()/".ssh"/"igrow_vps"),timeout=10)
checks={
 "VM":"uname -a; echo ====CPU====; nproc; lscpu | grep -E '^Model name:|^CPU\\(s\\):|^Thread\\(s\\) per core:'; echo ====MEM====; free -m; echo ====DISKS====; df -h / /var/lib/docker; echo ====UPTIME====; uptime",
 "DOCKER":"cd /opt/evolution && docker compose ps --format json",
 "CONTAINERS":"docker stats --no-stream --format '{{json .}}' evolution-evolution-1 evolution-postgres-1 evolution-redis-1 evolution-caddy-1",
 "LIMITS":"docker inspect evolution-evolution-1 evolution-postgres-1 evolution-redis-1 --format '{{.Name}} MEMORY={{.HostConfig.Memory}} MEMORY_RESERVATION={{.HostConfig.MemoryReservation}} CPU_QUOTA={{.HostConfig.CpuQuota}} NANO_CPUS={{.HostConfig.NanoCpus}} RESTART={{.HostConfig.RestartPolicy.Name}}'",
 "VOLUMES":"du -sh /opt/evolution /var/lib/docker/volumes 2>/dev/null",
 "VERSIONS":"cd /opt/evolution && docker compose exec -T evolution node -p 'process.version' 2>/dev/null",
 "OS":"cat /etc/os-release | head -8",
}
for name,cmd in checks.items():
 print("=== "+name+" ===")
 try:
  _,o,e=c.exec_command(cmd,timeout=12)
  txt=o.read().decode("utf-8","replace")
  err=e.read().decode("utf-8","replace")
  print(txt.encode("ascii","replace").decode()[:6000])
  if err:print("ERR",err.encode("ascii","replace").decode()[:300])
 except Exception as e:print("FAILED",str(e)[:200])
c.close()
