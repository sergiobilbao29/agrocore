"""
Genera las imagenes ilustrativas para el manual:
- Banners de cada modulo
- Diagrama de flujo de modulos
- Tarjetas de alertas
- Imagen de portada decorativa
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from pathlib import Path
import math

OUT = Path("/sessions/amazing-trusting-einstein/mnt/AgroCore/docs/build/imgs")
OUT.mkdir(parents=True, exist_ok=True)

# Colores corporativos
AGRO_DARK = (20, 83, 45)
AGRO_GREEN = (21, 128, 61)
AGRO_MED = (22, 101, 52)
AGRO_LIGHT = (240, 253, 244)
AGRO_50 = (240, 253, 244)
AGRO_100 = (220, 252, 231)
AGRO_200 = (187, 247, 208)
GOLD = (202, 138, 4)
GOLD_LIGHT = (234, 179, 8)
GOLD_PALE = (254, 240, 138)
BLUE = (30, 64, 175)
BLUE_LIGHT = (219, 234, 254)
AMBER_DARK = (180, 83, 9)
AMBER_LIGHT = (254, 243, 199)
SLATE_700 = (51, 65, 85)
SLATE_500 = (100, 116, 139)
WHITE = (255, 255, 255)

# Fonts
FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG  = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONT_ITAL = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf"

def make_module_banner(filename, emoji, title, subtitle, bg_color=AGRO_DARK, accent=GOLD):
    """Genera un banner ancho con icono + titulo del modulo."""
    W, H = 1400, 200
    img = Image.new('RGB', (W, H), bg_color)
    d = ImageDraw.Draw(img)
    # Gradient effect (simple horizontal stripes lighter on right)
    for i in range(W):
        alpha = i / W * 0.15
        r, g, b = bg_color
        c = (int(r + alpha*(255-r)), int(g + alpha*(255-g)), int(b + alpha*(255-b)))
        d.line([(i, 0), (i, H)], fill=c)
    # Decorative pattern dots
    for x in range(40, W, 60):
        for y in range(30, H, 60):
            d.ellipse([x-2, y-2, x+2, y+2], fill=(255, 255, 255, 30))
    # Left accent vertical bar
    d.rectangle([0, 0, 16, H], fill=accent)
    # Emoji icon (circle bg)
    icon_x, icon_y, icon_r = 80, H//2, 50
    d.ellipse([icon_x-icon_r, icon_y-icon_r, icon_x+icon_r, icon_y+icon_r], fill=WHITE)
    try:
        emoji_font = ImageFont.truetype("/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf", 60)
    except:
        emoji_font = ImageFont.truetype(FONT_BOLD, 60)
    # Center the emoji
    bbox = d.textbbox((0,0), emoji, font=emoji_font)
    text_w = bbox[2] - bbox[0]; text_h = bbox[3] - bbox[1]
    d.text((icon_x - text_w//2 - bbox[0], icon_y - text_h//2 - bbox[1]), emoji, font=emoji_font, fill=AGRO_DARK)
    # Title
    title_font = ImageFont.truetype(FONT_BOLD, 56)
    d.text((180, 50), title, font=title_font, fill=WHITE)
    # Subtitle
    sub_font = ImageFont.truetype(FONT_REG, 22)
    d.text((180, 125), subtitle, font=sub_font, fill=AGRO_200)
    # Save
    img.save(OUT / filename, 'PNG', dpi=(150, 150), optimize=True)
    print(f"OK {filename}")

# Generar banners de cada modulo
modules = [
    ("section_inicio.png", "🏠", "Inicio", "Tu primera mirada al sistema"),
    ("section_dashboard.png", "📊", "Dashboard", "Análisis operativo y financiero"),
    ("section_resumen.png", "🌐", "Resumen multi-empresa", "Vista consolidada de varias empresas"),
    ("section_produccion.png", "🌱", "Producción", "Campos, lotes, campañas e insumos"),
    ("section_stock.png", "📦", "Stock", "Inventario y movimientos"),
    ("section_contactos.png", "👥", "Contactos", "Clientes y proveedores"),
    ("section_finanzas.png", "💰", "Finanzas", "Tesorería, facturación, libro IVA"),
    ("section_logistica.png", "🚚", "Logística y RRHH", "Viajes y empleados"),
    ("section_admin.png", "⚙️", "Administración", "Catálogos, usuarios, roles, empresas"),
]
for f, e, t, s in modules:
    make_module_banner(f, e, t, s)

# Banner de portada decorativa
def make_cover_banner():
    W, H = 1400, 400
    img = Image.new('RGB', (W, H), AGRO_DARK)
    d = ImageDraw.Draw(img)
    # Gradient vertical
    for y in range(H):
        alpha = y / H * 0.4
        c = tuple(int(AGRO_DARK[i] + alpha * (AGRO_GREEN[i] - AGRO_DARK[i])) for i in range(3))
        d.line([(0, y), (W, y)], fill=c)
    # Pattern dots
    for x in range(0, W, 30):
        for y in range(0, H, 30):
            d.ellipse([x-1, y-1, x+1, y+1], fill=(255, 255, 255, 40))
    # Decorative wheat-like lines (stylized)
    for i in range(5):
        x = 1100 + i * 40
        for j in range(8):
            y = 100 + j * 20
            d.ellipse([x-3, y-6, x+3, y+6], fill=(GOLD_LIGHT[0], GOLD_LIGHT[1], GOLD_LIGHT[2]))
        d.line([(x, 100), (x, 360)], fill=GOLD, width=2)
    img.save(OUT / "cover_decoration.png", 'PNG', dpi=(150, 150))
    print("OK cover_decoration.png")
make_cover_banner()

# Diagrama de flujo entre modulos
def make_flow_diagram():
    W, H = 1400, 800
    img = Image.new('RGB', (W, H), WHITE)
    d = ImageDraw.Draw(img)
    # Title
    title_font = ImageFont.truetype(FONT_BOLD, 32)
    d.text((W//2 - 250, 30), "Integración entre módulos", font=title_font, fill=AGRO_DARK)
    sub_font = ImageFont.truetype(FONT_REG, 18)
    d.text((W//2 - 360, 75), "Una sola operación actualiza varios módulos automáticamente", font=sub_font, fill=SLATE_500)
    # Center node: Sistema
    cx, cy = W//2, 400
    box_font = ImageFont.truetype(FONT_BOLD, 22)
    sub2_font = ImageFont.truetype(FONT_REG, 14)
    def node(x, y, w, h, text, fill, text_color=WHITE, sub=None):
        d.rounded_rectangle([x-w//2, y-h//2, x+w//2, y+h//2], radius=20, fill=fill)
        bbox = d.textbbox((0,0), text, font=box_font)
        tw = bbox[2] - bbox[0]; th = bbox[3] - bbox[1]
        d.text((x - tw//2 - bbox[0], y - th//2 - bbox[1] - (10 if sub else 0)), text, font=box_font, fill=text_color)
        if sub:
            bbox = d.textbbox((0,0), sub, font=sub2_font)
            tw = bbox[2] - bbox[0]
            d.text((x - tw//2 - bbox[0], y + 6), sub, font=sub2_font, fill=text_color)
    # Center
    node(cx, cy, 280, 110, "Factura de venta", AGRO_GREEN, sub="(ejemplo)")
    # Outer modules
    radius = 270
    items = [
        (0, "Stock", "↓ Descuenta producto", AGRO_DARK),
        (60, "Cuenta corriente", "↑ Suma saldo cliente", AGRO_MED),
        (120, "Libro IVA", "↑ Suma débito fiscal", AGRO_MED),
        (180, "Flujo de caja", "↑ Cobro proyectado", AGRO_MED),
        (240, "Dashboard", "↑ Actualiza KPIs", AGRO_DARK),
        (300, "Cliente", "↑ Última factura", AGRO_MED),
    ]
    for i, (angle, label, action, color) in enumerate(items):
        a = math.radians(angle - 90)
        x = int(cx + radius * math.cos(a))
        y = int(cy + radius * math.sin(a))
        # Arrow from center to node
        # Calculate point on edge of center node and target
        # Simplified: just draw line with arrow
        # Compute direction
        dx, dy = x - cx, y - cy
        dist = math.sqrt(dx*dx + dy*dy)
        ux, uy = dx/dist, dy/dist
        # Start from edge of center node (140 wide)
        start_x = cx + int(ux * 145)
        start_y = cy + int(uy * 60)
        # End at edge of target node
        end_x = x - int(ux * 110)
        end_y = y - int(uy * 45)
        d.line([(start_x, start_y), (end_x, end_y)], fill=GOLD, width=3)
        # Arrowhead
        ah = 12
        ang = math.atan2(end_y - start_y, end_x - start_x)
        p1 = (end_x - ah * math.cos(ang - 0.4), end_y - ah * math.sin(ang - 0.4))
        p2 = (end_x - ah * math.cos(ang + 0.4), end_y - ah * math.sin(ang + 0.4))
        d.polygon([(end_x, end_y), p1, p2], fill=GOLD)
        # Node
        node(x, y, 220, 90, label, color, sub=action)
    img.save(OUT / "flow_diagram.png", 'PNG', dpi=(150, 150))
    print("OK flow_diagram.png")
make_flow_diagram()

# Tarjeta visual del Dashboard con alertas
def make_alerts_card():
    W, H = 1400, 500
    img = Image.new('RGB', (W, H), WHITE)
    d = ImageDraw.Draw(img)
    # Title
    title_font = ImageFont.truetype(FONT_BOLD, 28)
    d.text((40, 30), "⚠️  Panel de Alertas del Dashboard", font=title_font, fill=AGRO_DARK)
    sub_font = ImageFont.truetype(FONT_REG, 16)
    d.text((40, 70), "Información accionable lista para resolver", font=sub_font, fill=SLATE_500)
    # Alerts list
    body_font = ImageFont.truetype(FONT_BOLD, 18)
    desc_font = ImageFont.truetype(FONT_REG, 14)
    btn_font = ImageFont.truetype(FONT_BOLD, 13)
    alerts = [
        ("🔴", "Cheques vencidos sin cobrar", "3", "Sin cobrar — revisar", (220, 38, 38), (254, 226, 226)),
        ("⏰", "Cheques a vencer en 15 días  [NUEVO]", "5", "Anticipá la gestión de cobro", AMBER_DARK, AMBER_LIGHT),
        ("🟡", "Arrendamientos sin pagar", "2", "Próximos a vencer", (217, 119, 6), (254, 243, 199)),
        ("📦", "Productos bajo mínimo", "7", "Urea, Glifosato, Semilla soja...", AMBER_DARK, AMBER_LIGHT),
        ("💰", "Saldo por cobrar (clientes)", "$ 4.250.000", "Cuentas corrientes con saldo", AGRO_DARK, AGRO_100),
    ]
    y = 120
    for icon, title, count, desc, color_txt, color_bg in alerts:
        d.rounded_rectangle([40, y, 1360, y+60], radius=8, fill=color_bg, outline=color_txt, width=1)
        d.text((60, y+10), icon, font=ImageFont.truetype("/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf", 24), fill=SLATE_700)
        d.text((110, y+10), title, font=body_font, fill=color_txt)
        d.text((110, y+35), desc, font=desc_font, fill=SLATE_500)
        # Count badge
        cb_font = ImageFont.truetype(FONT_BOLD, 22)
        d.text((1100, y+18), count, font=cb_font, fill=color_txt)
        # Go button
        d.rounded_rectangle([1200, y+15, 1340, y+45], radius=6, fill=AGRO_GREEN)
        d.text((1230, y+22), "Ir →", font=btn_font, fill=WHITE)
        y += 70
    img.save(OUT / "alerts_card.png", 'PNG', dpi=(150, 150))
    print("OK alerts_card.png")
make_alerts_card()

# Tarjeta visual del Resumen multi-empresa
def make_multiempresa_card():
    W, H = 1400, 700
    img = Image.new('RGB', (W, H), WHITE)
    d = ImageDraw.Draw(img)
    # Header dark green box (consolidado)
    d.rounded_rectangle([40, 40, 1360, 240], radius=12, fill=AGRO_DARK)
    label_font = ImageFont.truetype(FONT_BOLD, 14)
    d.text((70, 65), "RESUMEN CONSOLIDADO  ·  3 de 3 EMPRESAS", font=label_font, fill=AGRO_200)
    # 4 KPIs
    kpi_label_font = ImageFont.truetype(FONT_REG, 14)
    kpi_value_font = ImageFont.truetype(FONT_BOLD, 36)
    kpi_sub_font = ImageFont.truetype(FONT_REG, 13)
    kpis = [
        ("Cheques en cartera", "12", "$ 8.450.000", WHITE),
        ("⏰ A vencer (15 días)", "5", "$ 2.180.000", GOLD_LIGHT),
        ("🔴 Vencidos sin cobrar", "3", "$ 950.000", (252, 165, 165)),
        ("Efectivo + Flujo caja", "$ 5.4M", "Ef: $1.2M · FC: $4.2M", WHITE),
    ]
    for i, (label, val, sub, color) in enumerate(kpis):
        x = 70 + i * 330
        d.text((x, 110), label, font=kpi_label_font, fill=AGRO_200)
        d.text((x, 130), val, font=kpi_value_font, fill=color)
        d.text((x, 190), sub, font=kpi_sub_font, fill=AGRO_200)
    # Desglose por empresa table
    table_title_font = ImageFont.truetype(FONT_BOLD, 18)
    d.text((40, 270), "Desglose por empresa", font=table_title_font, fill=AGRO_DARK)
    d.text((40, 300), "Los datos siguen separados por empresa. Esta vista solo suma los totales.", font=kpi_sub_font, fill=SLATE_500)
    # Header row
    y = 335
    h_font = ImageFont.truetype(FONT_BOLD, 13)
    d.rounded_rectangle([40, y, 1360, y+35], radius=6, fill=AGRO_DARK)
    headers = ["☑", "Empresa", "Cheq cart.", "$ cartera", "A venc 15d", "Vencidos", "Efectivo", "Flujo caja"]
    xs = [70, 110, 340, 440, 600, 740, 880, 1050]
    for hd, x in zip(headers, xs):
        d.text((x, y+10), hd, font=h_font, fill=WHITE)
    # Data rows
    rows = [
        (True, ("#22c55e", "AgroCore Demo"), "5", "$ 3.200.000", "2", "1", "$ 450.000", "$ 1.800.000"),
        (True, ("#3b82f6", "Campo Las 3 Marías"), "4", "$ 2.850.000", "2", "1", "$ 380.000", "$ 1.450.000"),
        (False, ("#d97706", "Hermanos Bilbao SRL"), "3", "$ 2.400.000", "1", "1", "$ 370.000", "$ 950.000"),
    ]
    row_font = ImageFont.truetype(FONT_REG, 13)
    bold_font = ImageFont.truetype(FONT_BOLD, 13)
    y = y + 40
    for checked, (color, name), c1, c2, c3, c4, c5, c6 in rows:
        bg = (248, 250, 252)
        d.rounded_rectangle([40, y, 1360, y+40], radius=6, fill=bg)
        if not checked:
            # Dim row
            d.rounded_rectangle([40, y, 1360, y+40], radius=6, fill=(243, 244, 246))
        # Checkbox
        if checked:
            d.rounded_rectangle([70, y+12, 90, y+32], radius=3, fill=AGRO_GREEN)
            d.text((73, y+13), "✓", font=bold_font, fill=WHITE)
        else:
            d.rounded_rectangle([70, y+12, 90, y+32], radius=3, outline=SLATE_500, width=1)
        # Color dot
        d.ellipse([110, y+13, 124, y+27], fill=color)
        d.text((130, y+12), name, font=bold_font, fill=AGRO_DARK if checked else SLATE_500)
        # Stats
        for txt, x in zip([c1, c2, c3, c4, c5, c6], [340, 440, 600, 740, 880, 1050]):
            color_txt = SLATE_500 if not checked else (
                (180,83,9) if "A venc" in headers[xs.index(x)] else
                (220,38,38) if "Vencido" in headers[xs.index(x)] and txt != "0" else
                AGRO_DARK)
            d.text((x, y+12), txt, font=row_font, fill=color_txt)
        y += 45
    img.save(OUT / "multiempresa_card.png", 'PNG', dpi=(150, 150))
    print("OK multiempresa_card.png")
make_multiempresa_card()

# Hectareas custom illustration
def make_hectareas_illustration():
    W, H = 1400, 500
    img = Image.new('RGB', (W, H), AGRO_50)
    d = ImageDraw.Draw(img)
    title_font = ImageFont.truetype(FONT_BOLD, 28)
    d.text((40, 30), "🌾  Hectáreas aplicadas: total vs parcial", font=title_font, fill=AGRO_DARK)
    sub_font = ImageFont.truetype(FONT_REG, 16)
    d.text((40, 70), "Útil cuando aplicás solo en una parte del lote (ej. el alrededor o un sector)", font=sub_font, fill=SLATE_500)

    # Lote 1: Aplicacion total
    box1_x, box1_y = 100, 140
    d.rounded_rectangle([box1_x, box1_y, box1_x+520, box1_y+280], radius=12, fill=AGRO_200, outline=AGRO_GREEN, width=2)
    # Inner pattern (filled completely)
    for r in range(0, 18):
        for c in range(0, 26):
            d.ellipse([box1_x+15+c*19, box1_y+30+r*14, box1_x+25+c*19, box1_y+40+r*14], fill=AGRO_GREEN)
    # Label
    h2_font = ImageFont.truetype(FONT_BOLD, 22)
    d.text((box1_x+10, box1_y+285+10), "Aplicación total (lote completo)", font=h2_font, fill=AGRO_DARK)
    d.text((box1_x+10, box1_y+285+40), "50 ha × $200/ha = $10.000", font=sub_font, fill=SLATE_700)

    # Lote 2: Aplicacion parcial (alrededor)
    box2_x, box2_y = 750, 140
    d.rounded_rectangle([box2_x, box2_y, box2_x+520, box2_y+280], radius=12, fill=AGRO_100, outline=GOLD, width=2)
    # Solo el alrededor (perimetro)
    for r in range(0, 18):
        for c in range(0, 26):
            # Solo bordes (primeras/ultimas filas y columnas)
            if r < 2 or r > 15 or c < 2 or c > 23:
                d.ellipse([box2_x+15+c*19, box2_y+30+r*14, box2_x+25+c*19, box2_y+40+r*14], fill=AMBER_DARK)
            else:
                d.ellipse([box2_x+15+c*19, box2_y+30+r*14, box2_x+25+c*19, box2_y+40+r*14], fill=(220, 220, 220))
    # Label
    d.text((box2_x+10, box2_y+285+10), "Aplicación parcial (solo el alrededor) *", font=h2_font, fill=AMBER_DARK)
    d.text((box2_x+10, box2_y+285+40), "15 ha × $200/ha = $3.000  →  marca con asterisco amarillo", font=sub_font, fill=SLATE_700)

    img.save(OUT / "hectareas_illustration.png", 'PNG', dpi=(150, 150))
    print("OK hectareas_illustration.png")
make_hectareas_illustration()

print("\n=== Imágenes generadas ===")
import os
for f in sorted(os.listdir(OUT)):
    size = (OUT / f).stat().st_size
    print(f"  {f}: {size:,} bytes")
