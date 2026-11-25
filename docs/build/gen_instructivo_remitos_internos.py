# -*- coding: utf-8 -*-
"""Instructivo: Remitos internos (estilo AgroCore).
  - Instructivo-Remitos-Internos.pdf
"""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTDIR = os.path.join(BASE, "Instructivos")
LOGO = os.path.join(BASE, "..", "web", "img", "logo-full-256.png")

G900 = colors.HexColor("#14532d"); G700 = colors.HexColor("#15803d")
G600 = colors.HexColor("#16a34a"); G100 = colors.HexColor("#dcfce7")
AMBER_BG = colors.HexColor("#fef3c7"); AMBER_BD = colors.HexColor("#f59e0b"); AMBER_TX = colors.HexColor("#92400e")
BLUE_BG = colors.HexColor("#e0f2fe"); BLUE_BD = colors.HexColor("#38bdf8"); BLUE_TX = colors.HexColor("#075985")
SLATE = colors.HexColor("#475569")

styles = getSampleStyleSheet()
def S(name, **kw): return ParagraphStyle(name, parent=styles["Normal"], **kw)
st_title = S("t", fontName="Helvetica-Bold", fontSize=20, textColor=G900, spaceAfter=2, leading=24)
st_sub   = S("s", fontName="Helvetica", fontSize=11, textColor=SLATE, spaceAfter=10, leading=15)
st_intro = S("i", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=16, spaceAfter=6)
st_h2    = S("h2", fontName="Helvetica-Bold", fontSize=13, textColor=G700, spaceBefore=12, spaceAfter=6, leading=17)
st_h3    = S("h3", fontName="Helvetica-Bold", fontSize=11.5, textColor=G900, spaceBefore=8, spaceAfter=3, leading=15)
st_step  = S("step", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#111827"), leading=16)
st_faq_q = S("faqq", fontName="Helvetica-Bold", fontSize=10.5, textColor=G900, leading=15, spaceBefore=6)
st_faq_a = S("faqa", fontName="Helvetica", fontSize=10.5, textColor=colors.HexColor("#1f2937"), leading=15)

KIND = {"g": (G100, G600, G900), "a": (AMBER_BG, AMBER_BD, AMBER_TX), "b": (BLUE_BG, BLUE_BD, BLUE_TX)}

def callout(text, kind="g"):
    bg, bd, tx = KIND[kind]
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

def build(filename, title, subtitle, blocks):
    out = os.path.join(OUTDIR, filename)
    doc = BaseDocTemplate(out, pagesize=A4, leftMargin=15*mm, rightMargin=15*mm, topMargin=30*mm, bottomMargin=20*mm)
    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id='f')
    doc.addPageTemplates([PageTemplate(id='main', frames=[frame], onPage=header_footer)])
    E = [Paragraph(title, st_title), Paragraph(subtitle, st_sub)]
    for kind, val in blocks:
        if kind == "intro":   E.append(Paragraph(val, st_intro))
        elif kind == "h2":    E.append(Paragraph(val, st_h2))
        elif kind == "h3":    E.append(Paragraph(val, st_h3))
        elif kind == "steps": E.append(steps(val))
        elif kind == "bullets": E.append(bullets(val))
        elif kind == "call":  E.append(callout(val[0], val[1]))
        elif kind == "faq":
            E.append(Paragraph("Preguntas frecuentes", st_h2))
            for q, a in val:
                E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))
    doc.build(E)
    print("PDF generado:", out)

# ============================================================
# REMITOS INTERNOS
# ============================================================
build("Instructivo-Remitos-Internos.pdf",
  "Remitos internos",
  "Mover mercadería sin venta: salida de insumo al campo y transferencias entre depósitos",
  [
    ("intro", "Un remito interno mueve mercadería dentro de tu propia operación, sin venta ni factura. Sirve para dos "
              "cosas: sacar insumos del depósito para llevarlos al campo, y trasladar mercadería de un depósito a "
              "otro. En los dos casos la mercadería sale del depósito al emitir el remito y hay un segundo paso de "
              "confirmación (qué se usó, o qué se recibió) antes de impactar del otro lado. Está en <b>Stock y depósitos &rarr; "
              "Remitos internos</b>."),
    ("h2", "Los dos circuitos de un vistazo"),
    ("h3", "Salida de insumo al campo:"),
    ("call", ("Emitís el remito (sale del depósito) &rarr; En tránsito &rarr; Confirmás ‘se usó’ (imputa a la campaña)", "b")),
    ("h3", "Transferencia entre depósitos:"),
    ("call", ("Emitís el remito (sale del origen) &rarr; En tránsito &rarr; Confirmás recepción (entra al destino)", "b")),
    ("h2", "1. ¿Qué es un remito interno?"),
    ("bullets", [
        "Es un movimiento de mercadería <b>sin venta</b>: no genera factura, no toca cuentas corrientes ni el Libro IVA. Solo mueve stock.",
        "Siempre descuenta del depósito de origen al emitirlo (la mercadería ya salió físicamente). Queda en estado <b>En tránsito</b>.",
        "El impacto del otro lado (imputar a la campaña, o sumar al depósito destino) ocurre al confirmar el segundo paso, no antes. Es la misma lógica del cheque depositado vs acreditado.",
        "Todo remito se puede imprimir (con firmas de entrega y recepción) y se puede anular (revierte todo el stock).",
    ]),
    ("h3", "Estados del remito"),
    ("bullets", [
        "<b>En tránsito:</b> la mercadería salió del depósito de origen. Falta confirmar el uso (al campo) o la recepción (entre depósitos).",
        "<b>Usado en campaña:</b> remito al campo confirmado: se imputó a la campaña como uso de insumo.",
        "<b>Recibido:</b> transferencia confirmada: la mercadería entró al depósito destino.",
        "<b>Anulado:</b> se revirtieron todos los movimientos de stock (y el uso en la campaña, si estaba imputado).",
    ]),
    ("h2", "2. Crear un remito"),
    ("bullets", [
        "Entrá a <b>Stock y depósitos &rarr; Remitos internos</b> y tocá <b>+ Nuevo remito</b>.",
        "Elegí el tipo: <b>Salida de insumo al campo</b> o <b>Transferencia entre depósitos</b>.",
        "Poné la fecha y el depósito de origen (o <b>Mi campo</b> si sale del campo).",
        "Agregá uno o varios productos con su cantidad (la unidad la toma del producto). Con <b>+ Agregar producto</b> sumás renglones.",
        "Guardá con <b>Emitir remito</b>. Queda <b>En tránsito</b> y el stock ya salió del origen.",
    ]),
    ("call", ("Los productos son los de tu <b>Catálogo</b>. Los depósitos son los que tenés cargados en Stock y depósitos (más ‘Mi campo’, que es el depósito por defecto).", "b")),
    ("h2", "3. Salida de insumo al campo"),
    ("intro", "Cuando sacás un insumo del depósito/galpón para llevarlo al lote, pero todavía no sabés si se va a usar entero."),
    ("bullets", [
        "Al emitir, el insumo se descuenta del depósito de una y el remito queda <b>En tránsito</b>. Opcionalmente ya podés elegir a qué campaña va (o dejarlo para el momento de confirmar).",
        "<b>Importante:</b> mientras está En tránsito NO se suma como costo a la campaña. Así no cargás de más si al final sobra.",
        "Cuando confirmás que se usó, tocás <b>Confirmar uso</b>, elegís la campaña y la fecha, y recién ahí se imputa como uso de insumo de esa campaña (aparece en Insumos y labores y en la planilla de resultado).",
    ]),
    ("call", ("Sale del depósito &rarr; En tránsito (no imputa) &rarr; Confirmar uso: imputa a la campaña", "b")),
    ("h2", "4. Transferencia entre depósitos"),
    ("intro", "Cuando mudás mercadería de un depósito a otro (por ejemplo de un galpón a otro campo)."),
    ("bullets", [
        "Elegís depósito de origen y depósito destino (no pueden ser el mismo) y los productos con su cantidad.",
        "Al emitir, la mercadería se descuenta del origen y el remito queda <b>En tránsito</b> (todavía no figura en el destino).",
        "Cuando la mercadería llega, tocás <b>Confirmar recepción</b>, poné la fecha y quién recibió, y ahí entra al stock del depósito destino.",
    ]),
    ("call", ("Sale del origen &rarr; En tránsito &rarr; Confirmar recepción: entra al destino", "b")),
    ("call", ("El paso de recepción sirve para controlar faltantes: si algo no llegó, no lo confirmás hasta aclararlo (o anulás y rehacés el remito).", "a")),
    ("h2", "5. Imprimir el remito"),
    ("bullets", [
        "Desde la lista, el botón impresora abre el remito para imprimir o guardar en PDF.",
        "Sale con el encabezado de tu empresa, el número y fecha, origen y destino, el detalle de productos y cantidades, y dos líneas de firma: Entrega y Recepción conforme.",
        "Aclara <b>DOCUMENTO NO VÁLIDO COMO FACTURA</b>: es un comprobante interno, para que quien recibe firme la conformidad.",
    ]),
    ("h2", "6. Anular un remito"),
    ("bullets", [
        "Con el botón <b>Anular</b> revertís el remito: vuelve la mercadería al depósito de origen, se saca del destino (si ya se había recibido) y se borra el uso imputado a la campaña (si estaba confirmado).",
        "Queda en estado <b>Anulado</b> como registro. Usalo si te equivocaste de producto, cantidad o depósito.",
    ]),
    ("h2", "7. ¿Cómo impacta en el stock?"),
    ("bullets", [
        "<b>Emitir remito:</b> stock origen baja (sale la mercadería); stock destino/campaña sin cambios.",
        "<b>Confirmar uso (al campo):</b> stock origen sin cambios (ya bajó); se imputa como uso de insumo de la campaña.",
        "<b>Confirmar recepción (entre dep.):</b> stock origen sin cambios (ya bajó); sube en el depósito destino.",
        "<b>Anular:</b> stock origen vuelve a subir; se revierte lo que se había imputado/recibido.",
    ]),
    ("call", ("<b>Regla práctica:</b> el stock del depósito de origen se ajusta SIEMPRE al emitir. Lo que cambia según el tipo es cuándo y dónde impacta el otro lado.", "g")),
    ("call", ("<b>AgroCore &rarr; Stock y depósitos &rarr; Remitos internos.</b> Cualquier duda, preguntale al asistente: ‘cómo hago un remito interno’.", "g")),
  ])
