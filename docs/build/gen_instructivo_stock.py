# -*- coding: utf-8 -*-
"""Instructivo: Stock de articulos (PDF, estilo AgroCore) - todas las funciones."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Stock.pdf")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
RED_BG = colors.HexColor("#fee2e2"); RED_BD = colors.HexColor("#ef4444"); RED_TX = colors.HexColor("#991b1b")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=21, textColor=G900, spaceAfter=2, leading=25)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13.5, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_h3    = S("h3", fontName="Helvetica-Bold", fontSize=11.5, textColor=G900, spaceBefore=8, spaceAfter=3, leading=15)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=16)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=15, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=15)
st_cell  = S("cell", fontName="Helvetica", fontSize=9, leading=12, textColor=colors.HexColor("#1f2937"))
st_cellb = S("cellb", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=G900)

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

def tabla(data, anchos):
    rows = []
    for r_i, row in enumerate(data):
        rows.append([Paragraph(c, st_cellb if r_i==0 else st_cell) for c in row])
    t = Table(rows, colWidths=anchos, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,0),G100),
        ("GRID",(0,0),(-1,-1),0.5,colors.HexColor("#cbd5e1")),
        ("VALIGN",(0,0),(-1,-1),"TOP"),
        ("LEFTPADDING",(0,0),(-1,-1),5),("RIGHTPADDING",(0,0),(-1,-1),5),
        ("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4),
    ]))
    return t

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
    E.append(Paragraph("Stock de artículos: la pantalla y todas sus funciones", st_title))
    E.append(Paragraph("Ver existencias, mover stock, ordenar la lista y las herramientas de mantenimiento", st_sub))
    E.append(Paragraph(
        "La pantalla de <b>Stock</b> (menú <b>Stock y Depósitos &rarr; Stock</b>) es el inventario de tu empresa: muestra cada "
        "<b>artículo</b> con su <b>existencia</b> por depósito, valorizada al último costo o promedio ponderado. Desde acá "
        "también movés el stock y tenés las herramientas para mantener la lista prolija. Este instructivo repasa cada botón y filtro.", st_intro))
    E.append(callout("<b>Clave:</b> el stock de un artículo NO se escribe a mano: es la <b>suma de sus movimientos</b> "
                     "(compras, ventas, uso de insumos, traspasos, ajustes...). Si un número no te cierra, se corrige con un "
                     "movimiento (ej. un ajuste por conteo físico), no editando la existencia.", G100, G600, G900))

    # Arriba: KPIs + filtros
    E.append(Paragraph("1 &nbsp;&mdash;&nbsp; La tabla: tarjetas, filtros y + Nuevo", st_h2))
    E.append(Paragraph("<b>Tarjetas de arriba:</b> Total SKU (artículos distintos), Bajo mínimo, Categorías y Sin stock (en cero).", st_intro))
    E.append(Paragraph("<b>Filtros:</b>", st_h3))
    E.append(bullets([
        "<b>Buscar producto</b>: por nombre, código o ubicación.",
        "<b>Depósito</b>: sin filtro ves la existencia <b>total consolidada</b> (suma de todos los depósitos); con un depósito, solo ese.",
        "<b>Categoría</b> y <b>Familia</b>: filtran por la clasificación del árbol.",
        "<b>Estado</b>: Todos / Bajo / OK y <b>⚠️ Sin clasificar</b> (muestra solo los artículos que quedaron sin familia en el árbol, para encontrarlos y acomodarlos).",
    ]))
    E.append(Paragraph("<b>+ Nuevo</b> da de alta un artículo (nombre, unidad, categoría/familia, mínimo, capacidades). "
                       "En cada fila hay botones para registrar un <b>ingreso</b>, un <b>egreso</b> y <b>editar</b> el artículo.", st_intro))
    E.append(callout("<b>Aviso “ver también X que no están en el Catálogo”:</b> Stock oculta por defecto los artículos "
                     "sin familia en el árbol. Ese check los muestra; para dejarlos prolijos, usá el filtro Estado → "
                     "Sin clasificar y después “Reubicar categoría” (ver abajo).", BLUE_BG, BLUE_BD, BLUE_TX))

    # Botones de la barra
    E.append(Paragraph("2 &nbsp;&mdash;&nbsp; Los botones de la barra de Stock", st_h2))
    E.append(tabla([
        ["Botón", "Para qué sirve"],
        ["\U0001F4B9 Reporte de margen", "Compara costo y precio de venta por artículo para ver la ganancia."],
        ["\U0001F501 Ir a Movimientos", "Abre el listado de movimientos de stock (entradas/salidas/ajustes)."],
        ["\U0001F331 Convertir grano a semilla", "Pasa parte de tu grano cosechado a semilla propia (insumo) para resembrar."],
        ["\U0001F500 Reubicar categoría", "Cambia la categoría/familia de VARIOS artículos a la vez (ver sección 3)."],
        ["\U0001F4CB Control de stock", "Exporta una planilla para el conteo físico y, al subirla, genera los ajustes."],
        ["\U0001F9F9 Depurar duplicados", "Une duplicados por nombre, corrige familias y limpia huérfanos vacíos."],
        ["\U0001F517 Fusionar artículos", "Une DOS artículos con nombres distintos en uno (ver sección 4)."],
        ["♻️ Recuperar artículos", "Vuelve a mostrar insumos/cereales que quedaron desactivados pero se usaban."],
        ["\U0001F9E9 Unificar artículos", "Deja una sola lista de insumos/cereales (ver sección 5). Se corre una vez por empresa."],
        ["\U0001F5C4 Recuperar desde backup", "Si un artículo se borró del todo, lo vuelve a traer del último respaldo del servidor (ver sección 6)."],
    ], [52*mm, 113*mm]))
    E.append(Paragraph("(Depurar, Fusionar, Recuperar, Unificar y Recuperar desde backup son de <b>administrador</b>.)", st_sub))

    # Reubicar
    E.append(Paragraph("3 &nbsp;&mdash;&nbsp; Reubicar categoría (clasificar los “sin clasificar”)", st_h2))
    E.append(Paragraph("Si un artículo quedó sin familia en el árbol, Stock lo oculta. Para acomodarlos:", st_intro))
    E.append(steps([
        "En Stock, filtro <b>Estado → ⚠️ Sin clasificar</b>: ves cuáles son.",
        "Botón <b>\U0001F500 Reubicar categoría</b>. Tildá <b>“Mostrar solo los sin clasificar”</b> para ver solo esos.",
        "Tocá <b>“Tildar los visibles”</b> para seleccionarlos todos de una (o tildá los que quieras).",
        "Elegí la <b>Categoría / Familia destino</b> y <b>Reubicar</b>. Quedan clasificados y dejan de aparecer en el aviso.",
    ]))

    # Fusionar
    E.append(Paragraph("4 &nbsp;&mdash;&nbsp; Fusionar artículos (dos nombres, un solo producto)", st_h2))
    E.append(Paragraph("Cuando el mismo producto se cargó con <b>dos nombres distintos</b> (ej. “2,4-D” y "
                       "“2,4-D ETIL HEXIL”), no son duplicado exacto, así que los unís a mano:", st_intro))
    E.append(steps([
        "Stock → <b>\U0001F517 Fusionar artículos</b>.",
        "Elegí el artículo a <b>ELIMINAR</b> (origen) y el que <b>QUEDA</b> (destino).",
        "<b>Fusionar</b>: el stock, los movimientos y las referencias pasan al que queda; el viejo se borra (y su artículo del catálogo) para que no reaparezca.",
    ]))
    E.append(callout("No se pierde ningún movimiento: todo lo del origen se reasigna al destino.", G100, G600, G900))

    # Unificar
    E.append(Paragraph("5 &nbsp;&mdash;&nbsp; Unificar artículos (una sola lista, se termina la duplicación)", st_h2))
    E.append(Paragraph("Si venís de antes, los insumos/cereales podían vivir en dos lados (catálogo viejo + stock) y por eso "
                       "se duplicaban o reaparecían. <b>Unificar</b> deja una sola lista:", st_intro))
    E.append(steps([
        "Hacé un <b>backup</b> de la base (es un cambio grande).",
        "Stock → <b>\U0001F9E9 Unificar artículos</b>. Mirá el <b>preview</b> (cuántos crea, cuántas filas viejas quita) y <b>Aplicá</b>.",
        "Migrá al stock lo que faltaba del catálogo (nombre, familia, precio) y quita del catálogo solo las filas de artículo de insumo/cereal (NO toca Labores, animales ni otros listados).",
        "Se corre <b>una vez por empresa</b>. Después, si quedan pares con nombres distintos, usá <b>Fusionar</b>.",
    ]))
    E.append(callout("<b>Cero pérdida de datos:</b> ningún movimiento, factura ni labor apunta al catálogo viejo, por eso se "
                     "puede unificar sin riesgo para el historial. Igual, hacé el backup antes.", AMBER_BG, AMBER_BD, AMBER_TX))

    # Recuperar desde backup
    E.append(Paragraph("6 &nbsp;&mdash;&nbsp; Recuperar artículos borrados (desde un respaldo)", st_h2))
    E.append(Paragraph("Si un artículo se <b>borró del todo</b> (no está ni desactivado), lo recuperás del último respaldo "
                       "del servidor con un clic, sin entrar a la base:", st_intro))
    E.append(steps([
        "Stock → <b>\U0001F5C4 Recuperar desde backup</b> (solo administrador).",
        "Elegí el <b>respaldo</b> a usar. Por defecto viene el más reciente; conviene uno con fecha <b>anterior</b> al momento en que se borraron.",
        "<b>Recuperar</b>. El sistema te dice cuántos artículos volvieron (de X a Y).",
    ]))
    E.append(callout("<b>No destructivo:</b> solo vuelve a crear los artículos que faltan (con su id original y su clasificación). "
                     "NO toca los que ya existen ni ningún otro dato (movimientos, facturas, etc.). Los artículos vuelven a la lista única.",
                     AMBER_BG, AMBER_BD, AMBER_TX))

    # Recuperar / Control
    E.append(Paragraph("7 &nbsp;&mdash;&nbsp; Recuperar un artículo desactivado y Control de stock", st_h2))
    E.append(bullets([
        "<b>♻️ Recuperar artículos</b>: si desapareció un insumo que sí usabas (ej. uno cargado desde una factura) y quedó <b>desactivado</b>, lo vuelve a mostrar en Stock y en los selectores. (Si se borró del todo, usá <b>Recuperar desde backup</b> de la sección 6.)",
        "<b>\U0001F4CB Control de stock</b>: 1) descargás la planilla Excel con el stock actual; 2) la completás con el conteo físico real; 3) la subís y el sistema genera los ajustes con tu usuario y la fecha. Ideal para el inventario periódico.",
    ]))

    # FAQ
    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("Un artículo me aparece dos veces en Stock. ¿Qué hago?",
         "Si tienen el MISMO nombre: Depurar duplicados los une. Si tienen nombres DISTINTOS pero son el mismo producto: Fusionar artículos."),
        ("Cargué un insumo desde una factura y no lo veo / desapareció.",
         "Corré Recuperar artículos. Y si quedó sin familia, acomodalo con Reubicar categoría (filtro Estado → Sin clasificar)."),
        ("Se borraron artículos por error y no los recupera Recuperar artículos.",
         "Usá Recuperar desde backup: elegí un respaldo anterior al borrado y los trae de vuelta sin tocar nada más."),
        ("Me sigue reapareciendo un artículo que borré del catálogo.",
         "Es la duplicación vieja. Corré Unificar artículos una vez en esa empresa: deja una sola lista y ya no reaparece."),
        ("La existencia de un artículo está mal. ¿La puedo editar a mano?",
         "No se edita el número: se corrige con un movimiento (un ajuste, o el Control de stock por conteo físico). Así queda el historial."),
        ("¿Para qué sirve la opción Estado ‘Sin clasificar’?",
         "Muestra solo los artículos que quedaron sin familia en el árbol, para encontrarlos y reubicarlos (clasificarlos)."),
    ]
    for q, a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
