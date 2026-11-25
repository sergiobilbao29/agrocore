# -*- coding: utf-8 -*-
"""Instructivo: Remitos de compra (recepcion -> factura) (PDF, estilo AgroCore)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Remitos-de-Compra.pdf")
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
    E.append(Paragraph("Remitos de compra", st_title))
    E.append(Paragraph("Recibir la mercadería con remito (suma stock) y después facturarla sin duplicar el inventario", st_sub))
    E.append(Paragraph(
        "El <b>remito de compra</b> es para cuando la mercadería llega <b>antes</b> que la factura. Cargás el "
        "remito al recibirla: el <b>stock entra de inmediato</b> y el comprobante queda <b>pendiente de facturar</b>. "
        "Cuando llega la factura del proveedor, la cargás y la <b>vinculás al remito</b>: genera la deuda pero "
        "<b>no vuelve a sumar stock</b> (ya entró con el remito). Está en <b>Comercial &rarr; Remitos de compra</b>.", st_intro))
    E.append(callout("<b>El circuito en una línea:</b> &nbsp; Remito (entra el stock, queda pendiente) &rarr; "
                     "Factura vinculada al remito (genera la deuda, NO suma stock de nuevo).", G100, G600, G900))
    E.append(callout("<b>Cuándo NO hace falta remito:</b> si comprás de mostrador y la mercadería llega junto con la "
                     "factura, seguí cargando la <b>factura de compra directa</b> de siempre (suma stock y genera la "
                     "deuda en un solo paso). El remito es opcional.", BLUE_BG, BLUE_BD, BLUE_TX))
    E.append(Spacer(1, 3))

    E.append(Paragraph("PASO 1 &nbsp;&mdash;&nbsp; Cargar el remito al recibir la mercadería", st_h2))
    E.append(steps([
        "Andá a <b>Comercial &rarr; Remitos de compra</b> y toca <b>&#65291; Nuevo remito</b>.",
        "Elegí el <b>proveedor</b>, la <b>fecha</b>, el <b>N&deg; de remito</b> del papel (opcional) y el "
        "<b>depósito</b> donde entra la mercadería.",
        "Agregá los <b>artículos</b> con la <b>cantidad recibida</b>. El <b>precio estimado</b> es opcional "
        "(sirve para valorizar lo que queda pendiente de facturar).",
        "Toca <b>Guardar remito</b>. El <b>stock sube al instante</b> y el remito queda en estado <b>&#9203; Pendiente</b> de facturar.",
    ]))

    E.append(Paragraph("PASO 2 &nbsp;&mdash;&nbsp; Facturar el remito (cuando llega la factura)", st_h2))
    E.append(steps([
        "Andá a <b>Comercial &rarr; Movimientos de compras &rarr; Nueva factura de compra</b> (o el botón de cargar factura).",
        "Elegí el <b>proveedor</b> y toca <b>&#128230; Vincular desde remito</b>.",
        "Se abre la lista de remitos pendientes del proveedor. <b>Tildá</b> los renglones a facturar y, si facturás "
        "parcial, ajustá la cantidad. Toca <b>Vincular a la factura</b>.",
        "Los artículos se cargan solos en la factura con el precio estimado. Si la factura vino con <b>otro precio</b>, "
        "corregilo en la grilla (así queda la deuda real).",
        "Completá tipo, número y fecha de la factura y <b>Guardar</b>. La factura <b>genera la deuda</b> en la cuenta "
        "del proveedor y <b>NO vuelve a sumar stock</b>. El remito pasa a <b>&#9989; Facturado</b> (o <b>&#9680; Parcial</b>).",
    ]))
    E.append(callout("<b>Diferencia de precio:</b> si el remito entró con $100 y la factura vino con $110, poné $110 "
                     "en la factura. La deuda y el IVA quedan por el valor real de la factura; el stock ya había "
                     "entrado con la cantidad del remito.", AMBER_BG, AMBER_BD, AMBER_TX))

    E.append(Paragraph("Facturaciones y recepciones parciales", st_h2))
    E.append(bullets([
        "<b>Un remito, varias facturas:</b> recibís 100 unidades en un remito y el proveedor factura 60 este mes y "
        "40 el que viene. Facturás 60 (queda <b>Parcial</b>) y más adelante los 40 (pasa a <b>Facturado</b>).",
        "<b>Varios remitos, una factura:</b> hiciste varias entregas (varios remitos) y el proveedor manda una sola "
        "factura. En &ldquo;Vincular desde remito&rdquo; tildás renglones de <b>todos</b> los remitos del proveedor en la misma factura.",
    ]))

    E.append(Paragraph("Devoluciones a proveedor", st_h2))
    E.append(bullets([
        "<b>Antes de facturar:</b> en el remito, botón <b>&#8617;&#65039;</b>, elegís qué devolver. Se genera un "
        "<b>remito de devolución</b> vinculado que <b>saca del stock</b> y baja la cantidad pendiente del remito "
        "original (la factura después se arma solo por lo que te quedaste).",
        "<b>Después de facturar:</b> primero hacés la devolución (sale del stock) y después cargás la <b>Nota de "
        "Crédito</b> del proveedor (Movimientos de compras &rarr; comprobante &ldquo;Nota de Crédito&rdquo;), que "
        "<b>baja la deuda</b> en la cuenta corriente.",
    ]))

    E.append(Paragraph("Control: mercadería recibida no facturada", st_h2))
    E.append(Paragraph("En la pantalla de Remitos de compra, el botón <b>&#128202; Recibido no facturado</b> muestra "
                       "todos los remitos pendientes o parciales <b>valorizados</b> (al precio estimado). Es el reporte "
                       "clave para el <b>cierre contable mensual</b>: cuánta mercadería entró al stock que todavía no "
                       "tiene factura.", st_intro))

    E.append(Paragraph("Remitos que NO se van a facturar: cerrarlos", st_h2))
    E.append(Paragraph(
        "A veces el proveedor nunca manda factura por un remito (acuerdo, bonificación, mercadería de muestra, "
        "o simplemente no la va a facturar). Para que ese remito <b>no quede pendiente para siempre</b> ni "
        "moleste en la lista de pendientes reales, usá el botón <b>&#128274; Cerrar sin facturar</b>.", st_intro))
    E.append(bullets([
        "La mercadería <b>ya entró y QUEDA en el stock</b>: cerrar el remito <b>no toca el inventario</b> ni la cuenta corriente.",
        "El remito pasa al estado <b>&#128274; Cerrado</b> y <b>sale</b> de los pendientes y del reporte &ldquo;Recibido no facturado&rdquo;.",
        "Si después de todo sí llega la factura, tocá <b>&#128275; Reabrir</b>: vuelve a Pendiente (o Parcial) y lo facturás normal.",
        "También podés cerrar un remito <b>Parcial</b> (facturaste una parte y el resto no se factura): cierra el saldo pendiente sin perder lo ya facturado.",
    ]))
    E.append(callout("<b>Cerrar vs. Anular:</b> &nbsp; <b>Cerrar</b> deja la mercadería en el stock (entró de verdad, solo no se "
                     "factura). <b>Anular</b> borra el stock que había sumado (se usa cuando el remito se cargó por error o la "
                     "mercadería no entró). No confundir.", AMBER_BG, AMBER_BD, AMBER_TX))

    E.append(Paragraph("Anular o corregir", st_h2))
    E.append(bullets([
        "Mientras el remito esté <b>pendiente y sin facturas vinculadas</b>, podés <b>editarlo</b> (rehace el stock) o <b>anularlo/eliminarlo</b> (revierte el stock).",
        "Si el remito ya tiene factura vinculada, primero <b>eliminá la factura</b> (eso devuelve el remito a pendiente) y recién ahí podés tocarlo.",
    ]))

    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("Si cargo el remito y después la factura, ¿no se duplica el stock?",
         "No. Si al cargar la factura usás 'Vincular desde remito', la factura solo genera la deuda y no vuelve a mover stock. El stock entra una sola vez, con el remito."),
        ("¿Puedo seguir cargando la factura directa sin remito?",
         "Sí. La factura de compra directa funciona igual que siempre (suma stock y genera la deuda juntas). El remito es opcional, para cuando la mercadería llega antes que la factura."),
        ("¿El remito lleva precios?",
         "El precio es estimado y opcional; sirve para valorizar lo pendiente de facturar. El costo real entra con la factura."),
        ("¿Qué pasa si el remito y la factura tienen cantidades un poco distintas (balanza)?",
         "Facturás la cantidad real de la factura. Si facturaste menos, el remito queda Parcial con el saldo pendiente; podés facturar ese saldo después."),
        ("¿Dónde veo lo que todavía no facturé?",
         "En Remitos de compra, con el estado Pendiente/Parcial, y en el reporte 'Recibido no facturado' (valorizado)."),
        ("Recibí un remito que el proveedor nunca va a facturar, ¿cómo lo saco de los pendientes?",
         "Con el botón 'Cerrar sin facturar'. La mercadería queda en el stock (entró de verdad) pero el remito pasa a Cerrado y deja de figurar en los pendientes. Si al final llega la factura, lo Reabrís y lo facturás."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
