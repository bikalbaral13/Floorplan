import json, sys
from epyt import epanet

d = epanet('Net1-gravity.inp')
d.setTimeSimulationDuration(0)
d.solveCompleteHydraulics()

nid = d.getNodeNameID(); lid = d.getLinkNameID()
H = d.getNodeHydraulicHead(); P = d.getNodePressure(); D = d.getNodeActualDemand()
E = d.getNodeElevations()
Q = d.getLinkFlows(); V = d.getLinkVelocity(); HL = d.getLinkHeadloss()
L = d.getLinkLength(); DI = d.getLinkDiameter()
idx_res = set(d.getNodeReservoirIndex())

FT=0.3048; GPM_LPS=0.0630901964; IN=25.4
out={'nodes':{},'links':{}}
for i,n in enumerate(nid):
    out['nodes'][n]={'elev_ft':float(E[i]),'head_ft':float(H[i]),'press_psi':float(P[i]),
                     'demand_gpm':float(D[i]),'reservoir':(i+1) in idx_res,
                     'elev_m':float(E[i])*FT,'head_m':float(H[i])*FT,
                     'press_m':float(H[i]-E[i])*FT,'demand_lps':float(D[i])*GPM_LPS}
for i,l in enumerate(lid):
    nodes=d.getLinkNodesIndex()[i]
    out['links'][l]={'from':nid[nodes[0]-1],'to':nid[nodes[1]-1],
        'len_ft':float(L[i]),'dia_in':float(DI[i]),
        'len_m':float(L[i])*FT,'dia_mm':float(DI[i])*IN,
        'flow_gpm':float(Q[i]),'flow_lps':float(Q[i])*GPM_LPS,
        'vel_fps':float(V[i]),'vel_ms':float(V[i])*FT,
        'headloss_ft':float(HL[i]),'headloss_m':float(HL[i])*FT}
json.dump(out,open('epanet_results.json','w'),indent=1)
d.unload()
print("EPANET nodes: head_ft / press_m")
for n,v in out['nodes'].items():
    print(f"  {n:>4}  H={v['head_ft']:9.3f} ft  p={v['press_m']:8.3f} m  q={v['demand_lps']:7.3f} L/s  res={v['reservoir']}")
print("EPANET links: flow / vel / headloss")
for l,v in out['links'].items():
    print(f"  {l:>4} {v['from']:>3}->{v['to']:<3} Q={v['flow_lps']:9.4f} L/s  V={v['vel_ms']:6.3f} m/s  hl={v['headloss_m']:8.4f} m")
