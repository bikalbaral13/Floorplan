"""Self-test variant: option K = option A with the rear pair split rear_split_pct / rest."""
def generate(p, T):
    if p["option"] != "K":
        return base.generate(p, T)
    res = base.generate(dict(p, option="A"), T)
    door = T.objects["door"].mod
    u3, u4 = res["units"][2], res["units"][3]
    total_w = u3["w"] + u4["w"]; u3["w"] = total_w * p["rear_split_pct"] / 100; u4["x"] = u3["x"] + u3["w"]; u4["w"] = total_w - u3["w"]
    for u in (u3, u4):
        u["a"] = u["w"] * u["h"]
        dp = {"width_ft": p["door_width_ft"], "position_pct": p[f"door{u['n']}_pct"], "margin_ft": 0.5}
        u["door"] = dict(door.place(dp, (u["x"], u["y"]), (u["x"] + u["w"], u["y"])), wall="N")
    res["total"] = sum(u["a"] for u in res["units"]); res["coverage_pct"] = res["total"] / res["site"]["area_sqft"] * 100
    res["option"] = "K"; res["option_title"] = T.schema["options"]["K"]["title"]
    return res
