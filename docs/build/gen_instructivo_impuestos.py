# -*- coding: utf-8 -*-
"""Instructivo: Otros impuestos y percepciones en facturas de compra (PDF, estilo AgroCore)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Otros-Impuestos-y-Percepciones.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=21, textColor=G900, spaceAfter=2, leading=25)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13.5, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=16)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=15, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=15)
st_cell  = S("cell", fontName="Helvetica", fontSize=9.5, textColor=colors.HexColor("#1f2937"), leading=13)
st_cellb = S("cellb", fontName="Helvetica-Bold", fontSize=9.5, textColor=G900, leading=13)
st_cellr = S("cellr", fontName="Helvetica", fontSize=9.5, textColor=colors.HexColor("#1f2937"), leading=13, alignment=2)

def callout(text, bg, bd, tx):
    p = Paragraph(text, S("c", fontName="Helvetica", fontSize=10, leading=15, textColor=tx))
    t = Table([[p]], colWidths=[165*mm])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),bg),("BOX",(0,0),(-1,-1),1.2,bd),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
        ("TOPPADDING",(0,0),(-1,-1),8),("BOTTOMPADDING",(0,0),(-1,-1),8)]))
    return t

def steps(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), value=i+1, leftIndent=6) for i,t in enumerate(items)],
        bulletType="1", bulletFontName="Helvetica-Bold", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=2, spaceAfter=2)

def bullets(items):
    return ListFlowable([ListItem(Paragraph(t, st_step), leftIndent=6) for t in items],
        bulletType="bullet", bulletChar="•", bulletColor=G600, leftIndent=16,
        bulletFontSize=10.5, spaceBefore=1, spaceAfter=1)

def header_footer(canvas, doc):
    canvas.saveState(); w, h = A4
    canvas.setFillColor(G900); canvas.rect(0, h-24*mm, w, 24*mm, fill=1, stroke=0)
    try: canvas.drawImage(LOGO, 15*mm, h-21*mm, width=16*mm, height=13.7*mm, preserveAspectRatio=True, mask='auto')
    except Exception: pass
    canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold", 13); canvas.drawString(34*mm, h-15*mm, "AgroCore")
    canvas.setFont("Helvetica", 10); canvas.drawRightString(w-15*mm, h-15*mm, "Instructivo")
    canvas.setStrokeColor(G100); canvas.setLineWidth(0.6); canvas.line(15*mm, 15*mm, w-15*mm, 15*mm)
    canvas.setFillColor(SLATE); canvas.setFont("Helvetica", 8)
    canvas.drawString(15*mm, 10*mm, "AgroCore - El corazón del negocio agrícola")
    canvas.drawRightString(w-15*mm, 10*mm, "Página %d" % doc.page)
    canvas.restoreState()

def build():
    doc = BaseDocTemplate(OUT, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = []
    E.append(Paragraph("Otros impuestos y percepciones", st_title))
    E.append(Paragraph("Cargar en una factura de compra los tributos que van después del IVA (combustibles, percepciones, CO2)", st_sub))
    E.append(Paragraph(
        "Algunas facturas no cierran solo con <b>precio x cantidad + IVA</b>: traen conceptos que se suman "
        "<b>después del IVA</b>, como el impuesto a los <b>combustibles (ITC/ICL)</b>, las <b>percepciones</b> "
        "(IIBB, IVA, Ganancias), el <b>CO2</b>, sellados, etc. Con la sección <b>Otros impuestos y percepciones</b> "
        "los cargás aparte y el total de la factura cierra exacto, <b>sin tocar el precio del producto ni el cálculo del IVA</b>.", st_intro))
    E.append(callout("<b>Regla de oro:</b> estos impuestos NO modifican el IVA. Se calculan aparte y se "
                     "<b>suman al TOTAL</b>. &nbsp; <b>Neto gravado + IVA + Otros impuestos = TOTAL de la factura.</b>", G100, G600, G900))
    E.append(callout("<b>¿Cuándo usarlos?</b> Cuando cargás la factura, el IVA da bien pero el <b>total no coincide</b> "
                     "con el papel. Esa diferencia casi siempre son estos \"otros tributos\". Antes se arreglaba inflando el "
                     "precio (y rompía el IVA); ahora se cargan acá.", BLUE_BG, BLUE_BD, BLUE_TX))
    E.append(Spacer(1, 3))

    # --- Parte 1: catalogo ---
    E.append(Paragraph("PARTE 1 &nbsp;&mdash;&nbsp; Configurar el catálogo de impuestos (una sola vez)", st_h2))
    E.append(Paragraph(
        "El <b>catálogo</b> es tu lista de impuestos reutilizables, para no tipearlos cada vez. AgroCore ya trae los "
        "más comunes cargados; podés editar o agregar los tuyos.", st_intro))
    E.append(steps([
        "Abrí una <b>factura de compra</b> (Comercial &rarr; Movimientos de compras &rarr; cargar factura).",
        "En la sección <b>&#129534; Otros impuestos y percepciones</b>, toca <b>&#9881;&#65039; Gestionar</b>.",
        "Para agregar uno nuevo: escribí el <b>Nombre</b> (ej. &ldquo;Percepción IIBB Córdoba&rdquo;), elegí el "
        "<b>Tipo</b> y toca <b>&#65291; Agregar al catálogo</b>.",
        "<b>Tipo Fijo:</b> es un importe en pesos que ponés en cada factura (ej. ITC, CO2, sellados). "
        "<b>Tipo %:</b> se calcula solo como un porcentaje; cargás la <b>alícuota</b> (ej. 3) y la <b>base</b> "
        "(neto gravado o total).",
        "Los que no uses más, los borrás con el &#128465;&#65039; (no afecta las facturas ya cargadas).",
    ]))
    E.append(Paragraph("Vienen precargados (podés cambiarlos):", st_intro))
    data = [
        [Paragraph("Impuesto", st_cellb), Paragraph("Tipo", st_cellb), Paragraph("Para qué sirve", st_cellb)],
        [Paragraph("ITC / ICL (combustibles)", st_cell), Paragraph("Fijo", st_cell), Paragraph("Impuestos a los combustibles del gasoil/nafta", st_cell)],
        [Paragraph("Impuesto CO2", st_cell), Paragraph("Fijo", st_cell), Paragraph("Tributo al dióxido de carbono (combustibles)", st_cell)],
        [Paragraph("Percepción IIBB", st_cell), Paragraph("% s/neto", st_cell), Paragraph("Percepción de Ingresos Brutos", st_cell)],
        [Paragraph("Percepción IVA", st_cell), Paragraph("% s/neto", st_cell), Paragraph("Percepción de IVA", st_cell)],
        [Paragraph("Percepción Ganancias", st_cell), Paragraph("% s/total", st_cell), Paragraph("Percepción de Impuesto a las Ganancias", st_cell)],
        [Paragraph("Otro tributo / sellado", st_cell), Paragraph("Fijo", st_cell), Paragraph("Cualquier otro concepto que traiga la factura", st_cell)],
    ]
    t = Table(data, colWidths=[52*mm, 26*mm, 87*mm])
    t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,0),G100), ("BOX",(0,0),(-1,-1),0.6,G600), ("INNERGRID",(0,0),(-1,-1),0.4,colors.HexColor("#bbf7d0")),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"), ("LEFTPADDING",(0,0),(-1,-1),6), ("RIGHTPADDING",(0,0),(-1,-1),6),
        ("TOPPADDING",(0,0),(-1,-1),4), ("BOTTOMPADDING",(0,0),(-1,-1),4),
    ]))
    E.append(t)

    # --- Parte 2: usar en factura ---
    E.append(Paragraph("PARTE 2 &nbsp;&mdash;&nbsp; Cargarlos en una factura", st_h2))
    E.append(steps([
        "Cargá la factura como siempre: <b>proveedor, items (cantidad x precio) y la alícuota de IVA</b> de cada renglón.",
        "En <b>Otros impuestos y percepciones</b>, elegí del desplegable <b>&ldquo;Elegir del catálogo&rdquo;</b> el "
        "impuesto que trae la factura (o toca <b>&#65291; Agregar</b> para una línea manual).",
        "Si es <b>fijo</b>, escribí el <b>importe</b> tal cual figura en la factura. Si es <b>%</b>, elegí la "
        "<b>base</b> (neto o total) y la <b>alícuota</b>: el importe se calcula solo.",
        "Mirá el cuadro verde: <b>Neto &middot; IVA &middot; Otros tributos &middot; TOTAL calculado</b>.",
        "Escribí el <b>Total informado en la factura</b> (lo que dice el papel) y confirmá que aparezca "
        "<b>&#9989; Coincide</b>. Si da &#9888;&#65039; diferencia, revisá un importe o agregá el tributo que falte.",
        "Guardá la factura. El total (con los otros impuestos) <b>genera la deuda</b> en la cuenta del proveedor y "
        "entra al <b>flujo de fondos</b>.",
    ]))

    # --- Ejemplo gasoil ---
    E.append(Paragraph("Ejemplo real: una factura de gasoil", st_h2))
    E.append(Paragraph("Así se arma una factura de combustible que trae ICL y CO2 además del IVA:", st_intro))
    ej = [
        [Paragraph("Concepto", st_cellb), Paragraph("Cómo se carga", st_cellb), Paragraph("Importe", st_cellb)],
        [Paragraph("Gasoil (item)", st_cell), Paragraph("Cantidad x precio, IVA 21%", st_cell), Paragraph("Neto 13.975,51", st_cellr)],
        [Paragraph("IVA 21%", st_cell), Paragraph("Lo calcula AgroCore", st_cell), Paragraph("2.934,86", st_cellr)],
        [Paragraph("ICL combustibles", st_cell), Paragraph("Otros impuestos - Fijo", st_cell), Paragraph("2.918,80", st_cellr)],
        [Paragraph("Impuesto CO2", st_cell), Paragraph("Otros impuestos - Fijo", st_cell), Paragraph("178,79", st_cellr)],
        [Paragraph("TOTAL", st_cellb), Paragraph("Neto + IVA + otros", st_cellb), Paragraph("20.007,96", st_cellr)],
    ]
    te = Table(ej, colWidths=[55*mm, 62*mm, 48*mm])
    te.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,0),G100), ("BACKGROUND",(0,-1),(-1,-1),colors.HexColor("#f0fdf4")),
        ("BOX",(0,0),(-1,-1),0.6,G600), ("INNERGRID",(0,0),(-1,-1),0.4,colors.HexColor("#bbf7d0")),
        ("LINEABOVE",(0,-1),(-1,-1),1.0,G600),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"), ("LEFTPADDING",(0,0),(-1,-1),6), ("RIGHTPADDING",(0,0),(-1,-1),6),
        ("TOPPADDING",(0,0),(-1,-1),4), ("BOTTOMPADDING",(0,0),(-1,-1),4),
    ]))
    E.append(te)
    E.append(Spacer(1, 2))
    E.append(callout("<b>Clave:</b> el ICL y el CO2 NO llevan IVA. Por eso van en \"Otros impuestos\" (se suman después) "
                     "y no como un renglón del gasoil. Así el IVA sigue siendo 21% del neto y el total cierra en 20.007,96.", AMBER_BG, AMBER_BD, AMBER_TX))

    # --- PDF / foto ---
    E.append(Paragraph("Si cargás la factura por PDF o foto", st_h2))
    E.append(bullets([
        "Al subir el <b>PDF o la foto</b>, AgroCore lee la factura y <b>carga solo</b> los otros impuestos en la sección, "
        "además de completar el <b>Total informado</b> para que compares.",
        "Revisá igual que el <b>TOTAL calculado coincida</b> con el total del papel antes de guardar. Si no, ajustá o "
        "agregá la línea que falte.",
    ]))

    # --- diferencia entre tipos ---
    E.append(Paragraph("Fijo vs. Porcentaje: cuál elegir", st_h2))
    E.append(bullets([
        "<b>Fijo:</b> cuando la factura ya te da el importe en pesos (ICL, CO2, un sellado puntual). Lo copiás tal cual.",
        "<b>Porcentaje:</b> cuando es una percepción que se calcula sobre un valor (ej. IIBB 3% del neto). Ponés la "
        "alícuota y la base y AgroCore lo calcula; útil para que no tengas que sacar la cuenta a mano.",
        "<b>Base neto</b> = se calcula sobre el neto gravado. <b>Base total</b> = sobre neto + IVA. Mirá en la factura "
        "sobre qué importe aplica la percepción.",
    ]))

    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("¿Esto cambia el IVA de la factura?",
         "No. Los otros impuestos se suman al total después del IVA y nunca modifican el cálculo del IVA. El IVA sigue saliendo de los items (precio x cantidad x alícuota)."),
        ("Antes ponía estos impuestos como un renglón más. ¿Está mal?",
         "Cargarlos como item inflaba el neto gravado y descuadraba el IVA y el Libro IVA. Lo correcto es cargarlos en 'Otros impuestos y percepciones', que no tocan el neto ni el IVA."),
        ("El total calculado no coincide con la factura. ¿Qué hago?",
         "Fijate la diferencia que te marca el cartel. Suele ser un tributo que falta cargar o un importe mal tipeado. Agregalo o corregilo hasta que diga 'Coincide'."),
        ("¿El catálogo es por empresa?",
         "Sí. Cada empresa tiene su propio catálogo de impuestos. Lo que cargues en una no aparece en otra."),
        ("¿Sirve para percepciones de IIBB o IVA?",
         "Sí. Cargalas como tipo Porcentaje con su alícuota y base, o como Fijo si ya sabés el importe. Se suman al total como cualquier otro tributo."),
        ("Ya tengo facturas viejas cargadas sin esto. ¿Se rompen?",
         "No. Las facturas anteriores quedan igual. Esto aplica a las que cargues o edites de ahora en más."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
