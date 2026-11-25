# -*- coding: utf-8 -*-
"""Instructivo: Comprobante interno en Compras y Ventas (PDF, estilo AgroCore)."""
import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, ListFlowable, ListItem)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "Instructivos", "Instructivo-Comprobante-Interno.pdf")
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
    E.append(Paragraph("Comprobante interno en Compras y Ventas", st_title))
    E.append(Paragraph("Registrar una operación con un número propio y facturarla después, sin duplicar nada", st_sub))
    E.append(Paragraph(
        "Muchas veces se hace la operación un día y la factura llega (o se emite) después. Con el <b>comprobante interno</b> "
        "podés registrar la compra o la venta <b>hoy</b>, con un <b>número propio</b> (ej. <b>CI-0007</b>): mueve igual la "
        "<b>cuenta corriente</b> y el <b>stock</b>, pero <b>no es fiscal</b> (no va a ARCA, no tiene CAE y no entra al Libro IVA). "
        "Cuando llega la factura, lo <b>facturás</b> y se le agrega el número de factura <b>sobre el mismo comprobante</b>, "
        "conservando el número interno. Así queda prolijo y siempre lo podés encontrar.", st_intro))
    E.append(callout("<b>La idea en una línea:</b> &nbsp; al dar de alta tildás <b>Comprobante interno</b> &rarr; el sistema le pone un "
                     "<b>Nro interno</b> (CI-####) &rarr; cuando llega la factura tocás <b>Facturar</b> y le cargás el número de factura. "
                     "Un solo registro, los dos números.", G100, G600, G900))

    E.append(Paragraph("PASO 1 &nbsp;&mdash;&nbsp; Cargar el comprobante interno", st_h2))
    E.append(steps([
        "Entra a <b>Ventas</b> (o <b>Compras</b>) y tocás <b>+ Emitir factura</b> / nueva compra como siempre.",
        "Arriba, tilda <b>&ldquo;Comprobante interno (sin factura)&rdquo;</b>. Se ocultan los campos fiscales (tipo A/B/C, punto de venta, número) porque todavía no hacen falta.",
        "Aparece el <b>Nro de comprobante interno</b> ya sugerido (ej. <b>CI-0007</b>). Es automático y correlativo por empresa; si querés podés cambiarlo.",
        "Carga el <b>cliente/proveedor</b>, los <b>renglones</b> (cantidad, precio) y la fecha, igual que una factura normal. Si no querés IVA, pone la alícuota en 0 en cada renglón.",
        "Guarda. Queda registrado: mueve la <b>cuenta corriente</b> y el <b>stock</b>, pero sin ARCA ni CAE.",
    ]))
    E.append(callout("<b>Lo ves fácil en el listado:</b> en <b>Movimientos de ventas</b> / <b>de compras</b> el comprobante aparece como "
                     "<b>&ldquo;Interno CI-####&rdquo;</b> y con el estado <b>&ldquo;A facturar&rdquo;</b>.", BLUE_BG, BLUE_BD, BLUE_TX))

    E.append(Paragraph("PASO 2 &nbsp;&mdash;&nbsp; Facturarlo cuando llega la factura", st_h2))
    E.append(steps([
        "En <b>Movimientos</b>, busca la fila del comprobante interno y toca el botón <b>Facturar</b> (icono <b>&#129534;&rarr;</b>).",
        "Carga los datos de la factura: <b>tipo</b> (A/B/C), <b>punto de venta</b> y <b>número</b>. Si la empresa factura por ARCA y ya tenés el <b>CAE</b>, cargalo también.",
        "Confirma. El comprobante pasa a <b>facturado</b> y se le agregan esos datos <b>sobre el mismo registro</b>, conservando el Nro interno.",
        "No se duplica nada: la cuenta corriente y el stock ya estaban desde que lo cargaste; solo se le suma el número de factura.",
    ]))
    E.append(callout("<b>Importante:</b> &ldquo;Facturar&rdquo; acá significa <b>registrar</b> el número de la factura en AgroCore. Si tu "
                     "empresa emite por ARCA, primero emití la factura (en AgroCore o en el portal de ARCA) y después copia ese número y "
                     "el CAE en esta pantalla.", AMBER_BG, AMBER_BD, AMBER_TX))

    E.append(Paragraph("PASO 3 &nbsp;&mdash;&nbsp; Encontrarlo después", st_h2))
    E.append(bullets([
        "Arriba de <b>Movimientos de ventas</b> y de <b>Movimientos de compras</b> hay un campo <b>&ldquo;Buscar (Nro interno / comprobante)&rdquo;</b>.",
        "Escribí el <b>CI-####</b> o el <b>número de factura</b> y la lista se filtra al instante.",
        "Cuando ya está facturado, la fila muestra la factura y, al lado, el <b>&ldquo;int CI-####&rdquo;</b> para que tengas los dos números asociados.",
    ]))

    E.append(Paragraph("Preguntas frecuentes", st_h2))
    faqs = [
        ("¿Sirve para compras y para ventas?",
         "Sí, en las dos. En Ventas tildás la opción al emitir; en Compras, al cargar la factura de compra."),
        ("¿El comprobante interno es una factura legal?",
         "No. Es un comprobante propio de gestión: mueve cuenta corriente y stock, pero no es fiscal (no va a ARCA, no tiene CAE y no figura en el Libro IVA). Lo fiscal aparece cuando lo facturás."),
        ("¿El número interno lo pongo yo?",
         "El sistema lo propone solo (CI-0001, CI-0002, ...) por empresa, y lo podés editar si preferís otro."),
        ("¿Cuando lo facturo, se duplica el importe o el stock?",
         "No. Es el mismo registro: al facturar solo se le agregan tipo, punto de venta, número (y CAE si corresponde). La cuenta corriente y el stock no se tocan de nuevo."),
        ("¿Puedo cobrarlo o pagarlo antes de facturarlo?",
         "Sí. Como ya movió la cuenta corriente, podés registrar el cobro (ventas) o el pago (compras) aunque todavía no tenga la factura."),
        ("¿Y si al final nunca se factura?",
         "Queda como comprobante interno: ordena tu cuenta corriente y tu stock igual. Simplemente no aparece en el Libro IVA porque no es fiscal."),
    ]
    for q,a in faqs:
        E.append(Paragraph(q, st_faq_q)); E.append(Paragraph(a, st_faq_a))

    doc.build(E)
    print("PDF generado:", OUT)

if __name__ == "__main__":
    build()
